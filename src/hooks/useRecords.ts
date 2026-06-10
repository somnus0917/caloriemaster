import { useCallback, useEffect, useRef, useState } from "react";
import type { Food, Record } from "../types";
import {
  createRecord as apiCreate,
  deleteRecord as apiDelete,
  listRecords,
  updateRecord as apiUpdate,
  type RecordDTO,
  type RecordInput,
} from "../services/records";
import { buildDemoWeek } from "../data/demoData";
import { getMealType } from "../utils/dates";
import { computeTotalCalories } from "../utils/validation";

/**
 * Server-backed records state.
 *
 * Records are the source of truth in PostgreSQL. The hook keeps a
 * React-state copy for rendering, but every mutator is async and
 * either the server succeeds (state updates) or it fails (state
 * stays untouched, error thrown back to the caller).
 */
function dtoToRecord(dto: RecordDTO): Record {
  return {
    id: dto.id,
    timestamp: dto.timestamp,
    mealType: dto.mealType,
    foods: dto.foods.map((f) => ({
      name: f.name,
      weight_g: f.weightG,
      calories_per_100g: f.caloriesPer100g,
      total_calories: f.totalCalories,
      confidence: (f.confidence ?? "med") as Food["confidence"],
      cal_source: (f.calorieSource ?? "ai_estimate") as Food["cal_source"],
      boohee_code: f.booheeCode ?? "",
      protein_per_100g: f.proteinPer100g ?? null,
      fat_per_100g: f.fatPer100g ?? null,
      carbohydrate_per_100g: f.carbohydratePer100g ?? null,
      health_light: (f.healthLight ? Number(f.healthLight) : 0) as Food["health_light"],
      food_image_url: undefined,
    })),
    totalCalories: dto.totalCalories,
    thumbnailUrl: dto.thumbnailUrl,
    isDemo: dto.isDemo,
  };
}

function buildInput(foods: Food[], weights: number[], thumbnailUrl: string | null, opts: { sourceId?: string; isDemo?: boolean } = {}): RecordInput {
  return {
    timestamp: Date.now(),
    mealType: getMealType(Date.now()),
    thumbnailUrl,
    sourceId: opts.sourceId,
    isDemo: opts.isDemo ?? false,
    items: foods.map((f, i) => ({
      name: f.name,
      weightG: weights[i],
      caloriesPer100g: f.calories_per_100g,
      totalCalories: computeTotalCalories(f.calories_per_100g, weights[i]),
      confidence: f.confidence,
      calorieSource: f.cal_source,
      booheeCode: f.boohee_code || undefined,
      proteinPer100g: f.protein_per_100g ?? null,
      fatPer100g: f.fat_per_100g ?? null,
      carbohydratePer100g: f.carbohydrate_per_100g ?? null,
      healthLight: f.health_light,
    })),
  };
}

export interface UseRecordsReturn {
  records: Record[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  addRecord: (foods: Food[], weights: number[], thumbnailUrl: string | null) => Promise<Record>;
  updateRecord: (id: string, foods: Food[], weights: number[]) => Promise<Record | null>;
  removeRecord: (id: string) => Promise<Record | null>;
  /** Re-create a previously deleted record (used for undo). */
  restoreRecord: (record: Record) => Promise<Record | null>;
  seedDemoIfEmpty: () => Promise<boolean>;
}

export function useRecords(): UseRecordsReturn {
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recordsRef = useRef<Record[]>(records);
  recordsRef.current = records;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dtos = await listRecords({ limit: 500 });
      const next = dtos
        .map(dtoToRecord)
        .sort((a, b) => b.timestamp - a.timestamp);
      recordsRef.current = next;
      setRecords(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "加载记录失败";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const addRecord = useCallback(
    async (foods: Food[], weights: number[], thumbnailUrl: string | null): Promise<Record> => {
      const input = buildInput(foods, weights, thumbnailUrl);
      const dto = await apiCreate(input);
      const rec = dtoToRecord(dto);
      const next = [rec, ...recordsRef.current.filter((r) => r.id !== rec.id)]
        .sort((a, b) => b.timestamp - a.timestamp);
      recordsRef.current = next;
      setRecords(next);
      return rec;
    },
    [],
  );

  const updateRecord = useCallback(
    async (id: string, foods: Food[], weights: number[]): Promise<Record | null> => {
      const existing = recordsRef.current.find((r) => r.id === id);
      if (!existing) return null;
      const input = buildInput(foods, weights, existing.thumbnailUrl);
      const dto = await apiUpdate(id, input);
      const rec = dtoToRecord(dto);
      const next = recordsRef.current
        .map((r) => (r.id === rec.id ? rec : r))
        .sort((a, b) => b.timestamp - a.timestamp);
      recordsRef.current = next;
      setRecords(next);
      return rec;
    },
    [],
  );

  const removeRecord = useCallback(async (id: string): Promise<Record | null> => {
    const existing = recordsRef.current.find((r) => r.id === id);
    if (!existing) return null;
    const dto = await apiDelete(id);
    const rec = dtoToRecord(dto);
    const next = recordsRef.current.filter((r) => r.id !== id);
    recordsRef.current = next;
    setRecords(next);
    return rec;
  }, []);

  const restoreRecord = useCallback(
    async (record: Record): Promise<Record | null> => {
      if (recordsRef.current.some((r) => r.id === record.id)) {
        // Already there — e.g. user tapped undo twice.
        return recordsRef.current.find((r) => r.id === record.id) ?? null;
      }
      const input = buildInput(record.foods, record.foods.map((f) => f.weight_g), record.thumbnailUrl, {
        sourceId: `undo-${record.id}-${Date.now()}`,
        isDemo: record.isDemo,
      });
      const dto = await apiCreate(input);
      const rec = dtoToRecord(dto);
      const next = [rec, ...recordsRef.current].sort((a, b) => b.timestamp - a.timestamp);
      recordsRef.current = next;
      setRecords(next);
      return rec;
    },
    [],
  );

  const seedDemoIfEmpty = useCallback(async (): Promise<boolean> => {
    if (recordsRef.current.length > 0) return false;
    // Generate demo records client-side and POST them via the import
    // endpoint so the server gets a single transaction and proper
    // validation.
    const demo = buildDemoWeek();
    const created: Record[] = [];
    for (const d of demo) {
      const dto = await apiCreate({
        timestamp: d.timestamp,
        mealType: d.mealType,
        thumbnailUrl: d.thumbnailUrl,
        sourceId: d.id,
        isDemo: true,
        items: d.foods.map((f) => ({
          name: f.name,
          weightG: f.weight_g,
          caloriesPer100g: f.calories_per_100g,
          totalCalories: f.total_calories,
          confidence: f.confidence,
          calorieSource: f.cal_source,
          booheeCode: f.boohee_code,
          proteinPer100g: f.protein_per_100g ?? null,
          fatPer100g: f.fat_per_100g ?? null,
          carbohydratePer100g: f.carbohydrate_per_100g ?? null,
          healthLight: f.health_light,
        })),
      });
      created.push(dtoToRecord(dto));
    }
    const next = [...created, ...recordsRef.current].sort((a, b) => b.timestamp - a.timestamp);
    recordsRef.current = next;
    setRecords(next);
    return true;
  }, []);

  return { records, loading, error, reload, addRecord, updateRecord, removeRecord, restoreRecord, seedDemoIfEmpty };
}
