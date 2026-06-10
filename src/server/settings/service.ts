/**
 * Per-user settings (calorie goal/limit) persistence. Auto-creates a
 * default row on first access.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { userSettings, type UserSettings } from "../db/schema.js";
import { ApiError, ErrorCode } from "../errors.js";

export interface SettingsView {
  dailyTarget: number;
  dailyLimit: number;
  updatedAt: string;
}

const MIN = 800;
const MAX_LIMIT = 8000;
const MAX_TARGET = 6000;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function toView(row: UserSettings): SettingsView {
  return {
    dailyTarget: row.dailyTarget,
    dailyLimit: row.dailyLimit,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getOrCreateSettings(userId: string): Promise<SettingsView> {
  const db = getDb();
  const rows = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  let row = rows[0];
  if (!row) {
    const inserted = await db
      .insert(userSettings)
      .values({ userId })
      .onConflictDoNothing()
      .returning();
    row = inserted[0];
    if (!row) {
      // Lost the race to another concurrent request — re-read.
      const again = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1);
      row = again[0];
    }
  }
  if (!row) {
    throw new ApiError(500, ErrorCode.DATABASE_ERROR, "无法读取设置");
  }
  return toView(row);
}

export interface UpdateSettingsInput {
  dailyTarget?: number;
  dailyLimit?: number;
}

export async function updateSettings(
  userId: string,
  input: UpdateSettingsInput,
): Promise<SettingsView> {
  if (
    (input.dailyTarget !== undefined && typeof input.dailyTarget !== "number") ||
    (input.dailyLimit !== undefined && typeof input.dailyLimit !== "number")
  ) {
    throw new ApiError(400, ErrorCode.INVALID_REQUEST, "目标与上限必须是数字");
  }
  const next: UpdateSettingsInput = {};
  if (typeof input.dailyTarget === "number") {
    next.dailyTarget = clamp(input.dailyTarget, MIN, MAX_TARGET);
  }
  if (typeof input.dailyLimit === "number") {
    next.dailyLimit = clamp(input.dailyLimit, MIN, MAX_LIMIT);
  }
  const db = getDb();
  await getOrCreateSettings(userId);
  const updated = await db
    .update(userSettings)
    .set({ ...next, updatedAt: new Date() })
    .where(eq(userSettings.userId, userId))
    .returning();
  const row = updated[0];
  if (!row) {
    throw new ApiError(500, ErrorCode.DATABASE_ERROR, "保存设置失败");
  }
  return toView(row);
}
