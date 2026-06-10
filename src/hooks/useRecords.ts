import { useCallback, useEffect, useState } from "react";
import type { Record } from "../types";
import { loadRecords, persistRecords } from "../storage/records";
import { newRecordId } from "../storage/records";
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

export function useRecords(): UseRecordsReturn {
  const [records, setRecords] = useState<Record[]>(() => loadRecords());

  const reload = useCallback(() => {
    setRecords(loadRecords());
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "calorie_records") reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reload]);

  const writeAndReload = useCallback(
    (next: Record[]) => {
      persistRecords(next);
      setRecords(next);
    },
    [],
  );

  const addRecord = useCallback(
    (foods: Food[], weights: number[], thumbnailUrl: string | null): Record => {
      const now = Date.now();
      const recordFoods = buildFoodsWithWeights(foods, weights);
      const record: Record = {
        id: newRecordId(now),
        timestamp: now,
        mealType: getMealType(now),
        foods: recordFoods,
        totalCalories: computeRecordTotal(recordFoods),
        thumbnailUrl,
      };
      const next = [...records, record];
      writeAndReload(next);
      return record;
    },
    [records, writeAndReload],
  );

  const updateRecord = useCallback(
    (id: string, foods: Food[], weights: number[]): Record | null => {
      const index = records.findIndex((r) => r.id === id);
      if (index < 0) return null;
      const existing = records[index];
      const recordFoods = buildFoodsWithWeights(foods, weights);
      const updated: Record = {
        ...existing,
        foods: recordFoods,
        totalCalories: computeRecordTotal(recordFoods),
      };
      const next = records.slice();
      next[index] = updated;
      writeAndReload(next);
      return updated;
    },
    [records, writeAndReload],
  );

  const removeRecord = useCallback(
    (id: string) => {
      const next = records.filter((r) => r.id !== id);
      writeAndReload(next);
    },
    [records, writeAndReload],
  );

  const restoreRecord = useCallback(
    (record: Record) => {
      if (records.some((r) => r.id === record.id)) return;
      const next = [...records, record].sort((a, b) => b.timestamp - a.timestamp);
      writeAndReload(next);
    },
    [records, writeAndReload],
  );

  const seedDemoIfEmpty = useCallback((): boolean => {
    if (records.length > 0) return false;
    const demo = buildDemoWeek();
    writeAndReload(demo);
    return true;
  }, [records, writeAndReload]);

  return { records, addRecord, updateRecord, removeRecord, restoreRecord, seedDemoIfEmpty, reload };
}
