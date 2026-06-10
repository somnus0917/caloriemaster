/**
 * Food records persistence layer. Every query is scoped to the
 * authenticated user; there is no public read path.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { foodItems, foodRecords, type FoodItem, type FoodRecord } from "../db/schema.js";
import { ApiError, ErrorCode } from "../errors.js";
import { computeItemTotal, RecordInputSchema, type RecordInput } from "../ai/validation.js";
import { getMealType } from "../../utils/dates.js";

export interface RecordWithItems {
  id: string;
  userId: string;
  sourceId: string | null;
  timestamp: number;
  mealType: string;
  totalCalories: number;
  thumbnailUrl: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  foods: FoodItemView[];
}

export interface FoodItemView {
  id: string;
  name: string;
  weightG: number;
  caloriesPer100g: number;
  totalCalories: number;
  confidence: string | null;
  calorieSource: string | null;
  booheeCode: string | null;
  proteinPer100g: number | null;
  fatPer100g: number | null;
  carbohydratePer100g: number | null;
  healthLight: string | null;
}

function toItemView(item: FoodItem): FoodItemView {
  return {
    id: item.id,
    name: item.name,
    weightG: item.weightG,
    caloriesPer100g: item.caloriesPer100g,
    totalCalories: item.totalCalories,
    confidence: item.confidence,
    calorieSource: item.calorieSource,
    booheeCode: item.booheeCode,
    proteinPer100g: item.proteinPer100g,
    fatPer100g: item.fatPer100g,
    carbohydratePer100g: item.carbohydratePer100g,
    healthLight: item.healthLight,
  };
}

function toRecordView(rec: FoodRecord, items: FoodItem[]): RecordWithItems {
  return {
    id: rec.id,
    userId: rec.userId,
    sourceId: rec.sourceId,
    timestamp: rec.timestamp.getTime(),
    mealType: rec.mealType,
    totalCalories: rec.totalCalories,
    thumbnailUrl: rec.thumbnailUrl,
    isDemo: rec.isDemo,
    createdAt: rec.createdAt.toISOString(),
    updatedAt: rec.updatedAt.toISOString(),
    foods: items
      .sort((a, b) => a.position - b.position)
      .map(toItemView),
  };
}

export async function listRecords(
  userId: string,
  options: { from?: number; to?: number; limit?: number } = {},
): Promise<RecordWithItems[]> {
  const db = getDb();
  const conditions = [eq(foodRecords.userId, userId)];
  if (typeof options.from === "number") {
    conditions.push(eq(foodRecords.timestamp, new Date(options.from)));
  }
  if (typeof options.to === "number") {
    conditions.push(eq(foodRecords.timestamp, new Date(options.to)));
  }
  const records = await db
    .select()
    .from(foodRecords)
    .where(and(...conditions))
    .orderBy(desc(foodRecords.timestamp))
    .limit(Math.min(Math.max(options.limit ?? 200, 1), 500));
  if (records.length === 0) return [];
  const recordIds = records.map((r) => r.id);
  const items = await db
    .select()
    .from(foodItems)
    .where(inArray(foodItems.recordId, recordIds));
  const itemsByRecord = new Map<string, FoodItem[]>();
  for (const it of items) {
    const arr = itemsByRecord.get(it.recordId) ?? [];
    arr.push(it);
    itemsByRecord.set(it.recordId, arr);
  }
  return records.map((r) => toRecordView(r, itemsByRecord.get(r.id) ?? []));
}

async function getRecordForUser(
  userId: string,
  recordId: string,
): Promise<{ record: FoodRecord; items: FoodItem[] } | null> {
  const db = getDb();
  const recRows = await db
    .select()
    .from(foodRecords)
    .where(and(eq(foodRecords.id, recordId), eq(foodRecords.userId, userId)))
    .limit(1);
  const rec = recRows[0];
  if (!rec) return null;
  const items = await db.select().from(foodItems).where(eq(foodItems.recordId, recordId));
  return { record: rec, items };
}

export async function getRecord(
  userId: string,
  recordId: string,
): Promise<RecordWithItems | null> {
  const r = await getRecordForUser(userId, recordId);
  return r ? toRecordView(r.record, r.items) : null;
}

function validateRecordInput(raw: unknown): RecordInput {
  const parsed = RecordInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, ErrorCode.INVALID_REQUEST, "记录数据不合法");
  }
  return parsed.data;
}

export async function createRecord(
  userId: string,
  rawInput: unknown,
): Promise<RecordWithItems> {
  const input = validateRecordInput(rawInput);
  const db = getDb();

  const items = input.items.map((it, idx) => ({
    position: idx,
    name: it.name,
    weightG: it.weightG,
    caloriesPer100g: it.caloriesPer100g,
    totalCalories: computeItemTotal(it.caloriesPer100g, it.weightG),
    confidence: it.confidence,
    calorieSource: it.calorieSource ?? "ai_estimate",
    booheeCode: it.booheeCode ?? null,
    proteinPer100g: it.proteinPer100g ?? null,
    fatPer100g: it.fatPer100g ?? null,
    carbohydratePer100g: it.carbohydratePer100g ?? null,
    healthLight: it.healthLight != null ? String(it.healthLight) : null,
  }));
  const totalCalories = items.reduce((s, it) => s + it.totalCalories, 0);
  const mealType = input.mealType || getMealType(input.timestamp);

  const recRows = await db
    .insert(foodRecords)
    .values({
      userId,
      sourceId: input.sourceId ?? null,
      timestamp: new Date(input.timestamp),
      mealType,
      totalCalories,
      thumbnailUrl: input.thumbnailUrl ?? null,
      isDemo: input.isDemo ?? false,
    })
    .onConflictDoNothing({ target: [foodRecords.userId, foodRecords.sourceId] })
    .returning();
  const rec = recRows[0];
  if (!rec) {
    // Source id collision — treat as idempotent: return the existing row.
    if (input.sourceId) {
      const existing = await db
        .select()
        .from(foodRecords)
        .where(
          and(
            eq(foodRecords.userId, userId),
            eq(foodRecords.sourceId, input.sourceId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        const view = await getRecord(userId, existing[0].id);
        if (view) return view;
      }
    }
    throw new ApiError(500, ErrorCode.DATABASE_ERROR, "保存失败，请稍后再试");
  }
  if (items.length > 0) {
    await db.insert(foodItems).values(items.map((it) => ({ ...it, recordId: rec!.id })));
  }
  const view = await getRecord(userId, rec.id);
  if (!view) {
    throw new ApiError(500, ErrorCode.DATABASE_ERROR, "保存失败，请稍后再试");
  }
  return view;
}

export async function updateRecord(
  userId: string,
  recordId: string,
  rawInput: unknown,
): Promise<RecordWithItems> {
  const input = validateRecordInput(rawInput);
  const db = getDb();
  const existing = await getRecordForUser(userId, recordId);
  if (!existing) {
    throw new ApiError(404, ErrorCode.RECORD_NOT_FOUND, "记录不存在或无权访问");
  }
  const items = input.items.map((it, idx) => ({
    position: idx,
    name: it.name,
    weightG: it.weightG,
    caloriesPer100g: it.caloriesPer100g,
    totalCalories: computeItemTotal(it.caloriesPer100g, it.weightG),
    confidence: it.confidence,
    calorieSource: it.calorieSource ?? "ai_estimate",
    booheeCode: it.booheeCode ?? null,
    proteinPer100g: it.proteinPer100g ?? null,
    fatPer100g: it.fatPer100g ?? null,
    carbohydratePer100g: it.carbohydratePer100g ?? null,
    healthLight: it.healthLight != null ? String(it.healthLight) : null,
  }));
  const totalCalories = items.reduce((s, it) => s + it.totalCalories, 0);
  const mealType = input.mealType || getMealType(input.timestamp);

  await db
    .update(foodRecords)
    .set({
      timestamp: new Date(input.timestamp),
      mealType,
      totalCalories,
      thumbnailUrl: input.thumbnailUrl ?? null,
      isDemo: input.isDemo ?? false,
      updatedAt: new Date(),
    })
    .where(and(eq(foodRecords.id, recordId), eq(foodRecords.userId, userId)));
  // Replace items wholesale — simpler than diffing and avoids stale rows.
  await db.delete(foodItems).where(eq(foodItems.recordId, recordId));
  if (items.length > 0) {
    await db.insert(foodItems).values(items.map((it) => ({ ...it, recordId })));
  }
  const view = await getRecord(userId, recordId);
  if (!view) {
    throw new ApiError(500, ErrorCode.DATABASE_ERROR, "更新失败，请稍后再试");
  }
  return view;
}

export async function deleteRecord(userId: string, recordId: string): Promise<RecordWithItems> {
  const existing = await getRecordForUser(userId, recordId);
  if (!existing) {
    throw new ApiError(404, ErrorCode.RECORD_NOT_FOUND, "记录不存在或无权访问");
  }
  const db = getDb();
  await db
    .delete(foodRecords)
    .where(and(eq(foodRecords.id, recordId), eq(foodRecords.userId, userId)));
  // The FK on food_items is ON DELETE CASCADE, but we keep the call
  // explicit for clarity.
  await db.delete(foodItems).where(eq(foodItems.recordId, recordId));
  return toRecordView(existing.record, existing.items);
}

export async function importRecords(
  userId: string,
  raw: unknown,
): Promise<{ imported: number; skipped: number }> {
  const records = (raw as { records?: unknown[] })?.records;
  if (!Array.isArray(records)) {
    throw new ApiError(400, ErrorCode.INVALID_REQUEST, "缺少 records 数组");
  }
  if (records.length === 0) {
    return { imported: 0, skipped: 0 };
  }
  if (records.length > 500) {
    throw new ApiError(400, ErrorCode.INVALID_REQUEST, "一次最多导入 500 条");
  }
  let imported = 0;
  let skipped = 0;
  for (const rawRecord of records) {
    const candidate = (rawRecord as { sourceId?: string })?.sourceId
      ? rawRecord
      : { ...(rawRecord as object), sourceId: `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    const before = await listRecords(userId, { limit: 1 });
    void before;
    try {
      await createRecord(userId, candidate);
      imported += 1;
    } catch (err) {
      if (err instanceof ApiError && (err.code === ErrorCode.EMAIL_ALREADY_EXISTS || err.code === "INVALID_REQUEST")) {
        // Source id already exists — treat as skip, not failure.
        skipped += 1;
        continue;
      }
      // Real error — bubble up so the import fails fast.
      throw err;
    }
  }
  return { imported, skipped };
}
