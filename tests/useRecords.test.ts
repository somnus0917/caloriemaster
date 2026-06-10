// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRecords } from "../src/hooks/useRecords";
import type { Food } from "../src/types";

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

const sampleRecordDto = {
  id: "r1",
  userId: "u1",
  sourceId: null,
  timestamp: 1700000000000,
  mealType: "午餐",
  totalCalories: 174,
  thumbnailUrl: null,
  isDemo: false,
  createdAt: "2023-11-14T22:13:20.000Z",
  updatedAt: "2023-11-14T22:13:20.000Z",
  foods: [
    {
      id: "f1",
      name: "米饭",
      weightG: 150,
      caloriesPer100g: 116,
      totalCalories: 174,
      confidence: "med",
      calorieSource: "ai_estimate",
      booheeCode: null,
      proteinPer100g: null,
      fatPer100g: null,
      carbohydratePer100g: null,
      healthLight: null,
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
    try {
      globalThis.localStorage.clear();
    } catch {
      // ignore
    }
  }
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function mockJsonResponse(body: unknown, init: { status?: number } = {}) {
  return {
    ok: init.status === undefined || init.status < 400,
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe("useRecords (API-backed)", () => {
  it("loads records on mount via GET /api/records", async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse({ records: [sampleRecordDto] }));
    const { result } = renderHook(() => useRecords());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.records).toHaveLength(1);
    expect(result.current.records[0].id).toBe("r1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^\/api\/records(\?|$)/);
    expect(init.credentials).toBe("include");
  });

  it("addRecord POSTs to /api/records and prepends the result", async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ records: [] }))
      .mockResolvedValueOnce(
        mockJsonResponse({ record: { ...sampleRecordDto, id: "r2", timestamp: 1700000001000 } }),
      );
    const { result } = renderHook(() => useRecords());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let added: import("../src/types").Record | null = null;
    await act(async () => {
      added = await result.current.addRecord(SAMPLE_FOODS, SAMPLE_WEIGHTS, null);
    });
    expect(added).not.toBeNull();
    expect(result.current.records).toHaveLength(1);
    expect(result.current.records[0].id).toBe("r2");
    const [, init] = fetchMock.mock.calls[1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).items[0].name).toBe("米饭");
  });

  it("removeRecord DELETEs and returns the removed record for undo", async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ records: [sampleRecordDto] }))
      .mockResolvedValueOnce(mockJsonResponse({ record: sampleRecordDto }));
    const { result } = renderHook(() => useRecords());
    await waitFor(() => expect(result.current.loading).toBe(false));
    let removed: { id?: string } = {};
    await act(async () => {
      const r = await result.current.removeRecord("r1");
      removed = r ?? {};
    });
    expect(removed.id).toBe("r1");
    expect(result.current.records).toHaveLength(0);
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });

  it("restoreRecord re-POSTs a previously deleted record", async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ records: [] }))
      .mockResolvedValueOnce(
        mockJsonResponse({ record: { ...sampleRecordDto, id: "r3", timestamp: 1700000002000 } }),
      );
    const { result } = renderHook(() => useRecords());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const record = {
      ...sampleRecordDto,
      id: "r3",
      timestamp: 1700000002000,
      mealType: "午餐",
      totalCalories: 174,
      foods: [
        {
          name: "米饭",
          weight_g: 150,
          calories_per_100g: 116,
          total_calories: 174,
          confidence: "med" as const,
          cal_source: "ai_estimate" as const,
        },
      ],
    };
    await act(async () => {
      await result.current.restoreRecord(record);
    });
    expect(result.current.records[0].id).toBe("r3");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });

  it("on server failure during addRecord, the local state stays unchanged", async () => {
    fetchMock
      .mockResolvedValueOnce(mockJsonResponse({ records: [] }))
      .mockResolvedValueOnce(
        mockJsonResponse({ error: { code: "DATABASE_ERROR", message: "boom" } }, { status: 500 }),
      );
    const { result } = renderHook(() => useRecords());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      try {
        await result.current.addRecord(SAMPLE_FOODS, SAMPLE_WEIGHTS, null);
      } catch {
        // expected
      }
    });
    expect(result.current.records).toHaveLength(0);
  });
});
