import type { Record } from "../types";

const STORAGE_KEY = "calorie_records";

export function loadRecords(): Record[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is Record =>
        r &&
        typeof r === "object" &&
        typeof r.id === "string" &&
        typeof r.timestamp === "number" &&
        Array.isArray(r.foods),
    );
  } catch {
    return [];
  }
}

export function persistRecords(records: Record[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    const stripped = records.map((r) => ({ ...r, thumbnailUrl: null }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripped));
  }
}

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; message?: string };
  return e.name === "QuotaExceededError" || /quota/i.test(e.message || "");
}

export function newRecordId(timestamp: number = Date.now()): string {
  return `${timestamp}-${Math.random().toString(36).slice(2, 7)}`;
}
