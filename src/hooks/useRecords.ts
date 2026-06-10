import { useCallback, useEffect, useRef, useState } from "react";
import type { Record } from "../types";
import { loadRecords, persistRecords, newRecordId } from "../storage/records";
import { getMealType } from "../utils/dates";
import { buildFoodsWithWeights, computeRecordTotal } from "../utils/nutrition";
import type { Food } from "../types";
import { buildDemoWeek } from "../data/demoData";

interface UseRecordsReturn {
  records: Record[];
  addRecord: (foods: Food[], weights: number[], thumbnailUrl: string | null) => Record;
  updateRecord: (id: string, foods: Food[], weights: number[]) => Record | null;
  removeRecord: (id: string) => void;
  restoreRecord: (record: Record) => void;
  seedDemoIfEmpty: () => boolean;
  reload: () => void;
}

function sortByTimestampDesc(records: Record[]): Record[] {
  return [...records].sort((a, b) => b.timestamp - a.timestamp);
}

function uniqueById(records: Record[]): Record[] {
  const seen = new Set<string>();
  const result: Record[] = [];
  for (const r of records) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    result.push(r);
  }
  return result;
}

/**
 * Records hook. Uses a ref to keep the latest known array and runs
 * every mutator through a single `commit` helper that:
 *   1. Computes the next array from the ref (no stale closure),
 *   2. Persists it,
 *   3. Updates both the ref and React state.
 *
 * If persist throws, the ref + state are NOT updated, so React memory
 * and localStorage stay in sync.
 */
export function useRecords(): UseRecordsReturn {
  const [records, setRecords] = useState<Record[]>(() => sortByTimestampDesc(loadRecords()));
  const recordsRef = useRef<Record[]>(records);
  recordsRef.current = records;

  const reload = useCallback(() => {
    const next = sortByTimestampDesc(loadRecords());
    recordsRef.current = next;
    setRecords(next);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "calorie_records") reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reload]);

  /**
   * Apply a state-mutating recipe against the latest known array. The
   * recipe receives the current array and returns the next one (or
   * `null` to abort). The function takes care of persistence, sorting,
   * de-duplication, ref + state updates, and rolls everything back on
   * persistence failure.
   */
  const commit = useCallback(
    (recipe: (current: Record[]) => Record[] | null): Record[] | null => {
      const current = recordsRef.current;
      const next = recipe(current);
      if (next === null) return null;
      const cleaned = sortByTimestampDesc(uniqueById(next));
      // If persist throws, the recordsRef and setRecords calls below
      // are skipped, keeping the browser's view in sync with disk.
      persistRecords(cleaned);
      recordsRef.current = cleaned;
      setRecords(cleaned);
      return cleaned;
    },
    [],
  );

  const addRecord = useCallback(
    (foods: Food[], weights: number[], thumbnailUrl: string | null): Record => {
      const now = Date.now();
      const id = newRecordId(now);
      const recordFoods = buildFoodsWithWeights(foods, weights);
      const record: Record = {
        id,
        timestamp: now,
        mealType: getMealType(now),
        foods: recordFoods,
        totalCalories: computeRecordTotal(recordFoods),
        thumbnailUrl,
      };
      const next = commit((current) => [...current, record]);
      if (!next) {
        throw new Error("记录保存失败：本地存储不可用");
      }
      return record;
    },
    [commit],
  );

  const updateRecord = useCallback(
    (id: string, foods: Food[], weights: number[]): Record | null => {
      let updated: Record | null = null;
      const result = commit((current) => {
        const index = current.findIndex((r) => r.id === id);
        if (index < 0) return null;
        const existing = current[index];
        const recordFoods = buildFoodsWithWeights(foods, weights);
        updated = {
          ...existing,
          foods: recordFoods,
          totalCalories: computeRecordTotal(recordFoods),
        };
        const next = current.slice();
        next[index] = updated;
        return next;
      });
      if (result === null) return null;
      return updated;
    },
    [commit],
  );

  const removeRecord = useCallback(
    (id: string) => {
      commit((current) => current.filter((r) => r.id !== id));
    },
    [commit],
  );

  const restoreRecord = useCallback(
    (record: Record) => {
      commit((current) => {
        if (current.some((r) => r.id === record.id)) {
          // Already restored (e.g. double-tap on the undo button).
          return current;
        }
        return [...current, record];
      });
    },
    [commit],
  );

  const seedDemoIfEmpty = useCallback((): boolean => {
    if (recordsRef.current.length > 0) return false;
    const demo = buildDemoWeek();
    commit(() => demo);
    return true;
  }, [commit]);

  return { records, addRecord, updateRecord, removeRecord, restoreRecord, seedDemoIfEmpty, reload };
}
