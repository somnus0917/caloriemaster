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
  thumbnail: string | null = null,
): Record {
  let added!: Record;
  act(() => {
    added = hook.current.addRecord(SAMPLE_FOODS, SAMPLE_WEIGHTS, thumbnail);
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

describe("useRecords: ordering and de-duplication", () => {
  it("sorts records by timestamp descending after add", async () => {
    const { result } = renderHook(() => useRecords());
    // Force distinct timestamps.
    const r1 = addSampleRecord(result);
    await new Promise((r) => setTimeout(r, 2));
    const r2 = addSampleRecord(result);
    await new Promise((r) => setTimeout(r, 2));
    const r3 = addSampleRecord(result);
    const ids = result.current.records.map((r) => r.id);
    expect(ids).toEqual([r3.id, r2.id, r1.id]);
  });

  it("undo after delete does not create a duplicate when the same record is restored", () => {
    const { result } = renderHook(() => useRecords());
    const r1 = addSampleRecord(result);
    const r2 = addSampleRecord(result);
    act(() => {
      result.current.removeRecord(r1.id);
    });
    expect(result.current.records.map((r) => r.id)).toEqual([r2.id]);
    act(() => {
      result.current.restoreRecord(r1);
    });
    act(() => {
      // A second restore with the same id should be a no-op.
      result.current.restoreRecord(r1);
    });
    expect(result.current.records).toHaveLength(2);
    expect(result.current.records.find((r) => r.id === r1.id)).toBeTruthy();
  });

  it("does not produce duplicate IDs when restoring the same record back-to-back", () => {
    const { result } = renderHook(() => useRecords());
    const r1 = addSampleRecord(result);
    act(() => {
      result.current.removeRecord(r1.id);
    });
    act(() => {
      result.current.restoreRecord(r1);
    });
    act(() => {
      result.current.removeRecord(r1.id);
    });
    act(() => {
      result.current.restoreRecord(r1);
    });
    const ids = result.current.records.map((r) => r.id);
    expect(ids.filter((id) => id === r1.id)).toHaveLength(1);
  });
});

describe("useRecords: image persistence (no imageDataUrl fallback)", () => {
  it("addRecord stores null thumbnailUrl when no thumbnail is provided", () => {
    const { result } = renderHook(() => useRecords());
    addSampleRecord(result, null);
    const stored = result.current.records[0];
    expect(stored.thumbnailUrl).toBeNull();
  });

  it("addRecord only stores the provided thumbnail, never an imageDataUrl", () => {
    const { result } = renderHook(() => useRecords());
    const thumb = "data:image/jpeg;base64,/9j/small-thumb";
    addSampleRecord(result, thumb);
    const stored = result.current.records[0] as unknown as Record;
    expect(stored.thumbnailUrl).toBe(thumb);
    expect((stored as unknown as { imageDataUrl?: unknown }).imageDataUrl).toBeUndefined();
  });

  it("persists to localStorage without any imageDataUrl field", () => {
    const { result } = renderHook(() => useRecords());
    addSampleRecord(result, "data:image/jpeg;base64,thumb");
    const raw = globalThis.localStorage.getItem("calorie_records") || "{}";
    expect(raw).not.toMatch(/imageDataUrl/);
  });
});
