// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecords } from "../src/hooks/useRecords";
import type { Food, Record } from "../src/types";

const SAMPLE_FOODS: Food[] = [
  {
    name: "米饭",
    weight_g: 150,
    calories_per_100g: 116,
    total_calories: 174,
    confidence: "med",
    cal_source: "ai_estimate",
  },
];

const SAMPLE_WEIGHTS = [150];

beforeEach(() => {
  if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
    try {
      globalThis.localStorage.clear();
    } catch {
      // ignore
    }
  }
});

function addSampleRecord(
  hook: { current: ReturnType<typeof useRecords> },
): Record {
  let added!: Record;
  act(() => {
    added = hook.current.addRecord(SAMPLE_FOODS, SAMPLE_WEIGHTS, null);
  });
  return added;
}

describe("useRecords", () => {
  it("adds a new record and exposes the create flow", () => {
    const { result } = renderHook(() => useRecords());
    const added = addSampleRecord(result);
    expect(added.id).toBeTruthy();
    expect(result.current.records).toHaveLength(1);
  });

  it("updates an existing record and recomputes totals from the new weight", () => {
    const { result } = renderHook(() => useRecords());
    const added = addSampleRecord(result);
    act(() => {
      const updated = result.current.updateRecord(
        added.id,
        SAMPLE_FOODS,
        [200],
      );
      expect(updated).not.toBeNull();
      expect(updated!.foods[0].weight_g).toBe(200);
      expect(updated!.foods[0].total_calories).toBe(232);
    });
  });

  it("removes a record", () => {
    const { result } = renderHook(() => useRecords());
    const added = addSampleRecord(result);
    act(() => {
      result.current.removeRecord(added.id);
    });
    expect(result.current.records).toHaveLength(0);
  });

  it("restores a soft-deleted record preserving id and order", () => {
    const { result } = renderHook(() => useRecords());
    const first = addSampleRecord(result);
    act(() => {
      result.current.removeRecord(first.id);
    });
    act(() => {
      result.current.restoreRecord(first);
    });
    expect(result.current.records).toHaveLength(1);
    expect(result.current.records[0].id).toBe(first.id);
  });

  it("does not seed demo data when records exist", () => {
    const { result } = renderHook(() => useRecords());
    addSampleRecord(result);
    let seeded: boolean | undefined;
    act(() => {
      seeded = result.current.seedDemoIfEmpty();
    });
    expect(seeded).toBe(false);
    expect(result.current.records).toHaveLength(1);
  });

  it("seeds demo data when storage is empty", () => {
    const { result } = renderHook(() => useRecords());
    expect(result.current.records).toHaveLength(0);
    let seeded: boolean | undefined;
    act(() => {
      seeded = result.current.seedDemoIfEmpty();
    });
    expect(seeded).toBe(true);
    expect(result.current.records.length).toBeGreaterThan(0);
    expect(result.current.records.every((r) => r.isDemo)).toBe(true);
  });
});
