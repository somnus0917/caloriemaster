import type { Record } from "../types";

const STORAGE_KEY = "calorie_records";
const CURRENT_VERSION = 1;

interface PersistedRecordsV1 {
  version: 1;
  records: Record[];
}

type PersistedShape = Record[] | PersistedRecordsV1;

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; message?: string };
  return e.name === "QuotaExceededError" || /quota/i.test(e.message || "");
}

/**
 * Validate a single record and return a sanitized copy. The browser
 * is hostile storage, so we re-check every field before trusting the
 * loaded data.
 */
function sanitizeRecord(raw: unknown): Record | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Record> & { id?: unknown; timestamp?: unknown; foods?: unknown };
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.timestamp !== "number" || !Number.isFinite(r.timestamp)) return null;
  if (!Array.isArray(r.foods)) return null;
  const foods = r.foods.filter((f): f is Record["foods"][number] => {
    if (!f || typeof f !== "object") return false;
    const food = f as { name?: unknown; weight_g?: unknown };
    return typeof food.name === "string" && typeof food.weight_g === "number";
  });
  if (foods.length === 0) return null;
  return {
    id: r.id,
    timestamp: r.timestamp,
    mealType: typeof r.mealType === "string" ? r.mealType : "",
    foods,
    totalCalories:
      typeof r.totalCalories === "number" && Number.isFinite(r.totalCalories)
        ? r.totalCalories
        : foods.reduce((s, f) => s + (typeof f.total_calories === "number" ? f.total_calories : 0), 0),
    thumbnailUrl:
      typeof r.thumbnailUrl === "string" ? r.thumbnailUrl : null,
    isDemo: r.isDemo === true,
  };
}

function extractRecords(parsed: PersistedShape | null): Record[] {
  if (!parsed) return [];
  if (Array.isArray(parsed)) {
    return parsed.map(sanitizeRecord).filter((r): r is Record => r !== null);
  }
  if (
    typeof parsed === "object" &&
    "version" in parsed &&
    (parsed as { version?: unknown }).version === 1 &&
    Array.isArray((parsed as PersistedRecordsV1).records)
  ) {
    return (parsed as PersistedRecordsV1).records
      .map(sanitizeRecord)
      .filter((r): r is Record => r !== null);
  }
  return [];
}

/**
 * Load records from localStorage. Returns a sanitized array. Never
 * throws: any JSON / shape / quota error results in an empty array so
 * the app cannot white-screen on bad persisted data.
 */
export function loadRecords(): Record[] {
  if (typeof localStorage === "undefined") return [];
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PersistedShape;
    return extractRecords(parsed);
  } catch {
    return [];
  }
}

export class RecordsStorageError extends Error {
  constructor(
    message: string,
    readonly code: "QUOTA_EXCEEDED" | "WRITE_BLOCKED" | "UNKNOWN",
  ) {
    super(message);
    this.name = "RecordsStorageError";
  }
}

export function persistRecords(records: Record[]): void {
  if (typeof localStorage === "undefined") return;
  const payload: PersistedRecordsV1 = {
    version: CURRENT_VERSION,
    records,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return;
  } catch (error) {
    if (!isQuotaError(error)) {
      const blocked =
        error instanceof DOMException &&
        (error.name === "SecurityError" || error.name === "InvalidStateError");
      throw new RecordsStorageError(
        blocked
          ? "浏览器禁止写入本地存储"
          : "保存失败，请稍后再试",
        blocked ? "WRITE_BLOCKED" : "UNKNOWN",
      );
    }
    // Quota exceeded: try to drop the in-memory thumbnails. The
    // original recognition image is never stored here in the first
    // place — this only affects optional thumbnails.
    const stripped = records.map((r) => ({ ...r, thumbnailUrl: null }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, records: stripped }));
    } catch {
      throw new RecordsStorageError(
        "本地存储已满，请删除部分记录后再试",
        "QUOTA_EXCEEDED",
      );
    }
  }
}

export function newRecordId(timestamp: number = Date.now()): string {
  return `${timestamp}-${Math.random().toString(36).slice(2, 7)}`;
}
