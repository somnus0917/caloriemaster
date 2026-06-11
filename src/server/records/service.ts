/**
 * Food records persistence layer. Every query is scoped to the
 * authenticated user; there is no public read path.
 *
 * Image lifecycle:
 *   1. Client submits a small Data URL thumbnail (optional).
 *   2. The server decodes it, processes it through sharp (re-encode
 *      to WebP, strip metadata, cap dimensions) and uploads to OSS
 *      via the `ObjectStorage` interface.
 *   3. Only the object key is stored on `foodRecords.imageObjectKey`.
 *   4. The browser fetches a short-lived signed URL via
 *      `/api/records/:id/image-url` when it actually needs to
 *      render the image.
 *
 * Failure compensation:
 *   - OSS unavailable  → record is saved without an image.
 *   - OSS upload fails  → DB never touched, throw IMAGE_UPLOAD_FAILED.
 *   - DB write fails after OSS upload  → best-effort delete the
 *     just-uploaded OSS object so we don't leave orphans.
 *   - Record removal only deletes the DB row. OSS images are left in
 *     place because end-user deletion is an app-level hide/remove action.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { foodItems, foodRecords, type FoodItem, type FoodRecord } from "../db/schema.js";
import { ApiError, ErrorCode } from "../errors.js";
import { computeItemTotal, RecordInputSchema, type RecordInput } from "../ai/validation.js";
import { getMealType } from "../../utils/dates.js";
import { decodeDataUrlImage } from "../storage/dataUrl.js";
import { ImageProcessingError, processImage, processOriginalImage } from "../storage/imageProcessor.js";
import { getObjectStorage, isStorageConfigured } from "../storage/index.js";
import type { ObjectStorage, SupportedImageMime, UploadedImage } from "../storage/storage.js";

export interface RecordWithItems {
  id: string;
  userId: string;
  sourceId: string | null;
  timestamp: number;
  mealType: string;
  totalCalories: number;
  thumbnailUrl: string | null;
  /** True iff the server has an OSS object for this record's image. */
  hasImage: boolean;
  imageMimeType: string | null;
  imageSize: number | null;
  /** True iff the server has an OSS object for this record's original image. */
  hasOriginalImage: boolean;
  originalImageMimeType: string | null;
  originalImageSize: number | null;
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
    hasImage: Boolean(rec.imageObjectKey),
    imageMimeType: rec.imageMimeType,
    imageSize: rec.imageSize,
    hasOriginalImage: Boolean(rec.originalImageObjectKey),
    originalImageMimeType: rec.originalImageMimeType,
    originalImageSize: rec.originalImageSize,
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

function buildItems(input: RecordInput) {
  return input.items.map((it, idx) => ({
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
}

interface PreparedImage {
  objectKey: string;
  mimeType: string;
  size: number;
}

interface PreparedImages {
  thumbnail: PreparedImage;
  original: PreparedImage;
}

/**
 * Decode the data URL, run it through the server-side image
 * processor, and upload both thumbnail and original to OSS.
 * The caller passes the record id (or `null` for the import path
 * which generates its own).
 */
async function processAndUpload(
  userId: string,
  recordId: string,
  dataUrl: string,
  storage: ObjectStorage,
): Promise<PreparedImages> {
  const decoded = decodeDataUrlImage(dataUrl);
  if (!decoded.ok) {
    throw new ApiError(
      decoded.code === "IMAGE_TOO_LARGE" ? 413 : 400,
      decoded.code,
      decoded.message,
    );
  }

  // Process both thumbnail and original in parallel
  let thumbnailProcessed: { data: Buffer; mimeType: SupportedImageMime; size: number };
  let originalProcessed: { data: Buffer; mimeType: SupportedImageMime; size: number };
  try {
    [thumbnailProcessed, originalProcessed] = await Promise.all([
      processImage(decoded.data),
      processOriginalImage(decoded.data),
    ]);
  } catch (err) {
    if (err instanceof ImageProcessingError) {
      const status = err.code === "IMAGE_TOO_LARGE" ? 413 : 400;
      throw new ApiError(status, err.code, err.message);
    }
    throw err;
  }

  // Upload both images in parallel
  let thumbnailUploaded: UploadedImage;
  let originalUploaded: UploadedImage;
  try {
    [thumbnailUploaded, originalUploaded] = await Promise.all([
      storage.uploadRecordImage({
        userId,
        recordId,
        data: thumbnailProcessed.data,
        mimeType: thumbnailProcessed.mimeType,
      }),
      storage.uploadOriginalImage({
        userId,
        recordId,
        data: originalProcessed.data,
        mimeType: originalProcessed.mimeType,
      }),
    ]);
  } catch (err) {
    console.error("[records] OSS upload failed", {
      userId,
      recordId,
      code: "IMAGE_UPLOAD_FAILED",
      err: (err as Error).message,
    });
    throw new ApiError(502, ErrorCode.IMAGE_UPLOAD_FAILED, "图片保存失败，请稍后重试");
  }

  return {
    thumbnail: {
      objectKey: thumbnailUploaded.objectKey,
      mimeType: thumbnailUploaded.mimeType,
      size: thumbnailUploaded.size,
    },
    original: {
      objectKey: originalUploaded.objectKey,
      mimeType: originalUploaded.mimeType,
      size: originalUploaded.size,
    },
  };
}

async function safeDelete(storage: ObjectStorage, objectKey: string | null, ctx: Record<string, unknown>): Promise<void> {
  if (!objectKey) return;
  try {
    await storage.deleteObject(objectKey);
  } catch (err) {
    // Orphan: log structured so a future cleanup job can pick this up.
    console.error("[records] OSS orphan delete failed", {
      objectKey,
      ...ctx,
      err: (err as Error).message,
    });
  }
}

export async function createRecord(
  userId: string,
  rawInput: unknown,
): Promise<RecordWithItems> {
  const input = validateRecordInput(rawInput);
  const db = getDb();
  const storage = getObjectStorage();
  const canStoreImages = isStorageConfigured();
  const items = buildItems(input);
  const totalCalories = items.reduce((s, it) => s + it.totalCalories, 0);
  const mealType = input.mealType || getMealType(input.timestamp);

  // 1. Pre-allocate the record id so the OSS object key can use it.
  //    Postgres `uuid` default is gen_random_uuid(), which means we
  //    can't rely on the server-generated id for the object key path.
  //    Instead, we generate the id in JS (still a v4 UUID) and pass
  //    it explicitly.
  const recordId = crypto.randomUUID();
  let uploaded: PreparedImages | null = null;

  try {
    // 2. Image (optional)
    if (input.thumbnailDataUrl && canStoreImages) {
      uploaded = await processAndUpload(userId, recordId, input.thumbnailDataUrl, storage);
    }

    // 3. DB insert
    const recRows = await db
      .insert(foodRecords)
      .values({
        id: recordId,
        userId,
        sourceId: input.sourceId ?? null,
        timestamp: new Date(input.timestamp),
        mealType,
        totalCalories,
        thumbnailUrl: null, // legacy column: no longer used for new records
        imageObjectKey: uploaded?.thumbnail.objectKey ?? null,
        imageMimeType: uploaded?.thumbnail.mimeType ?? null,
        imageSize: uploaded?.thumbnail.size ?? null,
        originalImageObjectKey: uploaded?.original.objectKey ?? null,
        originalImageMimeType: uploaded?.original.mimeType ?? null,
        originalImageSize: uploaded?.original.size ?? null,
        isDemo: input.isDemo ?? false,
      })
      .onConflictDoNothing({ target: [foodRecords.userId, foodRecords.sourceId] })
      .returning();
    const rec = recRows[0];

    if (!rec) {
      // Source id collision — treat as idempotent: return the
      // existing row, but we still have a possibly-orphaned OSS
      // objects. Delete them and return the existing record.
      if (uploaded) {
        await Promise.all([
          safeDelete(storage, uploaded.thumbnail.objectKey, { reason: "sourceId-collision", userId }),
          safeDelete(storage, uploaded.original.objectKey, { reason: "sourceId-collision", userId }),
        ]);
      }
      if (input.sourceId) {
        const existing = await db
          .select()
          .from(foodRecords)
          .where(and(eq(foodRecords.userId, userId), eq(foodRecords.sourceId, input.sourceId)))
          .limit(1);
        if (existing[0]) {
          const view = await getRecord(userId, existing[0].id);
          if (view) return view;
        }
      }
      throw new ApiError(500, ErrorCode.DATABASE_ERROR, "保存失败，请稍后再试");
    }

    if (items.length > 0) {
      await db
        .insert(foodItems)
        .values(items.map((it) => ({ ...it, recordId: rec!.id })));
    }

    const view = await getRecord(userId, rec.id);
    if (!view) {
      throw new ApiError(500, ErrorCode.DATABASE_ERROR, "保存失败，请稍后再试");
    }
    return view;
  } catch (err) {
    // If we got past the upload step and the DB then failed, roll
    // the OSS objects back so we don't leave orphans.
    if (uploaded) {
      await Promise.all([
        safeDelete(storage, uploaded.thumbnail.objectKey, {
          reason: "db-failed-after-upload",
          userId,
          recordId,
        }),
        safeDelete(storage, uploaded.original.objectKey, {
          reason: "db-failed-after-upload",
          userId,
          recordId,
        }),
      ]);
    }
    throw err;
  }
}

export type ThumbnailAction =
  | { type: "keep" }
  | { type: "remove" }
  | { type: "replace"; dataUrl: string };

export async function updateRecord(
  userId: string,
  recordId: string,
  rawInput: unknown,
): Promise<RecordWithItems> {
  const input = validateRecordInput(rawInput);
  const existing = await getRecordForUser(userId, recordId);
  if (!existing) {
    throw new ApiError(404, ErrorCode.RECORD_NOT_FOUND, "记录不存在或无权访问");
  }
  const db = getDb();
  const storage = getObjectStorage();
  const canStoreImages = isStorageConfigured();
  const items = buildItems(input);
  const totalCalories = items.reduce((s, it) => s + it.totalCalories, 0);
  const mealType = input.mealType || getMealType(input.timestamp);

  // Default to "keep" so the absence of `thumbnailAction` doesn't
  // surprise the user.
  const action: ThumbnailAction = (rawInput as { thumbnailAction?: ThumbnailAction })?.thumbnailAction ?? { type: "keep" };
  let newImages: PreparedImages | null = null;
  const oldThumbnailKey: string | null = existing.record.imageObjectKey;
  const oldOriginalKey: string | null = existing.record.originalImageObjectKey;

  try {
    if (action.type === "replace" && canStoreImages) {
      newImages = await processAndUpload(userId, recordId, action.dataUrl, storage);
    }

    await db
      .update(foodRecords)
      .set({
        timestamp: new Date(input.timestamp),
        mealType,
        totalCalories,
        thumbnailUrl: null,
        imageObjectKey: action.type === "remove" ? null : newImages?.thumbnail.objectKey ?? oldThumbnailKey,
        imageMimeType: action.type === "remove" ? null : newImages?.thumbnail.mimeType ?? existing.record.imageMimeType,
        imageSize: action.type === "remove" ? null : newImages?.thumbnail.size ?? existing.record.imageSize,
        originalImageObjectKey: action.type === "remove" ? null : newImages?.original.objectKey ?? oldOriginalKey,
        originalImageMimeType: action.type === "remove" ? null : newImages?.original.mimeType ?? existing.record.originalImageMimeType,
        originalImageSize: action.type === "remove" ? null : newImages?.original.size ?? existing.record.originalImageSize,
        isDemo: input.isDemo ?? false,
        updatedAt: new Date(),
      })
      .where(and(eq(foodRecords.id, recordId), eq(foodRecords.userId, userId)));

    await db.delete(foodItems).where(eq(foodItems.recordId, recordId));
    if (items.length > 0) {
      await db
        .insert(foodItems)
        .values(items.map((it) => ({ ...it, recordId })));
    }

    // After the DB commit succeeds, best-effort delete the old
    // OSS objects if we replaced or removed the image. A failure
    // here is an orphan, not a user-visible error.
    if (action.type !== "keep") {
      const keysToDelete: string[] = [];
      if (oldThumbnailKey && oldThumbnailKey !== newImages?.thumbnail.objectKey) {
        keysToDelete.push(oldThumbnailKey);
      }
      if (oldOriginalKey && oldOriginalKey !== newImages?.original.objectKey) {
        keysToDelete.push(oldOriginalKey);
      }
      await Promise.all(
        keysToDelete.map((key) =>
          safeDelete(storage, key, {
            reason: "replaced-or-removed",
            userId,
            recordId,
          })
        )
      );
    }

    const view = await getRecord(userId, recordId);
    if (!view) {
      throw new ApiError(500, ErrorCode.DATABASE_ERROR, "更新失败，请稍后再试");
    }
    return view;
  } catch (err) {
    // If we replaced the image and then the DB write failed, roll
    // the new OSS objects back.
    if (newImages) {
      await Promise.all([
        safeDelete(storage, newImages.thumbnail.objectKey, {
          reason: "db-failed-after-replace",
          userId,
          recordId,
        }),
        safeDelete(storage, newImages.original.objectKey, {
          reason: "db-failed-after-replace",
          userId,
          recordId,
        }),
      ]);
    }
    throw err;
  }
}

export async function deleteRecord(userId: string, recordId: string): Promise<{ deletedId: string }> {
  const existing = await getRecordForUser(userId, recordId);
  if (!existing) {
    throw new ApiError(404, ErrorCode.RECORD_NOT_FOUND, "记录不存在或无权访问");
  }
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(foodItems).where(eq(foodItems.recordId, recordId));
    await tx
      .delete(foodRecords)
      .where(and(eq(foodRecords.id, recordId), eq(foodRecords.userId, userId)));
  });
  return { deletedId: recordId };
}

export interface SignedImageUrl {
  url: string;
  expiresIn: number;
}

export async function createSignedImageUrl(
  userId: string,
  recordId: string,
  type: "thumbnail" | "original" = "thumbnail",
): Promise<SignedImageUrl> {
  const existing = await getRecordForUser(userId, recordId);
  if (!existing) {
    throw new ApiError(404, ErrorCode.RECORD_NOT_FOUND, "记录不存在");
  }

  const objectKey = type === "original"
    ? existing.record.originalImageObjectKey
    : existing.record.imageObjectKey;

  if (!objectKey) {
    throw new ApiError(404, ErrorCode.IMAGE_NOT_FOUND, "该记录没有图片");
  }

  try {
    const url = await getObjectStorage().createSignedGetUrl(objectKey);
    return { url, expiresIn: 600 };
  } catch (err) {
    console.error("[records] signed URL failed", {
      userId,
      recordId,
      type,
      err: (err as Error).message,
    });
    throw new ApiError(500, ErrorCode.IMAGE_URL_SIGN_FAILED, "无法生成图片访问地址");
  }
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
  if (records.length > 100) {
    throw new ApiError(400, ErrorCode.INVALID_REQUEST, "一次最多导入 100 条");
  }
  let imported = 0;
  let skipped = 0;
  for (const rawRecord of records) {
    const candidate = (rawRecord as { sourceId?: string })?.sourceId
      ? rawRecord
      : { ...(rawRecord as object), sourceId: `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    try {
      await createRecord(userId, candidate);
      imported += 1;
    } catch (err) {
      if (err instanceof ApiError && (err.code === ErrorCode.EMAIL_ALREADY_EXISTS || err.code === "INVALID_REQUEST")) {
        // Source id already exists — treat as skip, not failure.
        skipped += 1;
        continue;
      }
      throw err;
    }
  }
  return { imported, skipped };
}

void asc; // keep import surface stable for future
