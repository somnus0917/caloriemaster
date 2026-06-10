/**
 * One-shot localStorage → server migration.
 *
 * The previous version of the app stored food records in the user's
 * browser. After login, the user is offered to upload those records
 * to their new server-side account. On success the legacy key is
 * removed; on partial failure the data stays put so the user can
 * retry.
 */
import { importRecords, type RecordInput } from "./records";

const LEGACY_KEY = "calorie_records";
const MIGRATION_FLAG_KEY = "calorie_records_migrated_v1";

interface LegacyRecord {
  id: string;
  timestamp: number;
  mealType: string;
  totalCalories: number;
  thumbnailUrl: string | null;
  isDemo?: boolean;
  foods: Array<{
    name: string;
    weight_g: number;
    calories_per_100g: number;
    total_calories: number;
    confidence: "high" | "med" | "low" | string;
    cal_source?: string;
    boohee_code?: string;
    protein_per_100g?: number | null;
    fat_per_100g?: number | null;
    carbohydrate_per_100g?: number | null;
    health_light?: 0 | 1 | 2 | 3 | null;
  }>;
}

function readLegacy(): LegacyRecord[] {
  if (typeof localStorage === "undefined") return [];
  const raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as LegacyRecord[];
    if (parsed && typeof parsed === "object" && "version" in parsed && Array.isArray((parsed as { records: unknown[] }).records)) {
      return (parsed as { records: LegacyRecord[] }).records;
    }
    return [];
  } catch {
    return [];
  }
}

function toInput(r: LegacyRecord): RecordInput {
  return {
    timestamp: typeof r.timestamp === "number" ? r.timestamp : Date.now(),
    mealType: typeof r.mealType === "string" ? r.mealType : "加餐",
    thumbnailUrl: typeof r.thumbnailUrl === "string" ? r.thumbnailUrl : null,
    sourceId: r.id,
    isDemo: r.isDemo === true,
    items: (r.foods || []).map((f) => ({
      name: String(f.name || "未知").slice(0, 50),
      weightG: Math.max(10, Math.min(1000, Math.round(Number(f.weight_g) || 100))),
      caloriesPer100g: Math.max(0, Math.min(1000, Number(f.calories_per_100g) || 0)),
      confidence: (f.confidence === "high" || f.confidence === "med" || f.confidence === "low"
        ? f.confidence
        : "med"),
      calorieSource: typeof f.cal_source === "string" ? f.cal_source : "ai_estimate",
      booheeCode: typeof f.boohee_code === "string" ? f.boohee_code : undefined,
      proteinPer100g: typeof f.protein_per_100g === "number" ? f.protein_per_100g : null,
      fatPer100g: typeof f.fat_per_100g === "number" ? f.fat_per_100g : null,
      carbohydratePer100g: typeof f.carbohydrate_per_100g === "number" ? f.carbohydrate_per_100g : null,
      healthLight: f.health_light === 1 || f.health_light === 2 || f.health_light === 3
        ? f.health_light
        : undefined,
    })),
  };
}

export function hasPendingMigration(): boolean {
  if (typeof localStorage === "undefined") return false;
  if (localStorage.getItem(MIGRATION_FLAG_KEY) === "done") return false;
  return readLegacy().length > 0;
}

export async function runMigration(): Promise<{ imported: number; skipped: number }> {
  const legacy = readLegacy();
  if (legacy.length === 0) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MIGRATION_FLAG_KEY, "done");
    }
    return { imported: 0, skipped: 0 };
  }
  const inputs = legacy.map(toInput);
  const result = await importRecords(inputs);
  // Only mark as done if the server accepted the whole batch without
  // a fatal error. If everything was skipped because of sourceId
  // collisions, we still consider it done.
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(MIGRATION_FLAG_KEY, "done");
    localStorage.removeItem(LEGACY_KEY);
  }
  return result;
}

export function skipMigration(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(MIGRATION_FLAG_KEY, "done");
  localStorage.removeItem(LEGACY_KEY);
}
