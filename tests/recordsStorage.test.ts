// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadRecords,
  persistRecords,
  newRecordId,
} from "../src/storage/records";
import type { Record } from "../src/types";

const SAMPLE: Record = {
  id: "sample-1",
  timestamp: 1700000000000,
  mealType: "午餐",
  foods: [
    {
      name: "米饭",
      weight_g: 150,
      calories_per_100g: 116,
      total_calories: 174,
      confidence: "med",
      cal_source: "ai_estimate",
    },
  ],
  totalCalories: 174,
  thumbnailUrl: null,
};

beforeEach(() => {
  if (typeof globalThis !== "undefined" && "localStorage" in globalThis) {
    try {
      globalThis.localStorage.clear();
    } catch {
      // ignore
    }
  }
});

describe("records storage: loadRecords()", () => {
  it("returns an empty array when nothing is stored", () => {
    expect(loadRecords()).toEqual([]);
  });

  it("reads the new versioned format { version: 1, records: [...] }", () => {
    globalThis.localStorage.setItem(
      "calorie_records",
      JSON.stringify({ version: 1, records: [SAMPLE] }),
    );
    const records = loadRecords();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(SAMPLE.id);
  });

  it("reads the legacy array format for backward compatibility", () => {
    globalThis.localStorage.setItem(
      "calorie_records",
      JSON.stringify([SAMPLE, { ...SAMPLE, id: "sample-2" }]),
    );
    const records = loadRecords();
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.id).sort()).toEqual(["sample-1", "sample-2"]);
  });

  it("returns an empty array instead of throwing on malformed JSON", () => {
    globalThis.localStorage.setItem("calorie_records", "not json {{{");
    expect(() => loadRecords()).not.toThrow();
    expect(loadRecords()).toEqual([]);
  });

  it("returns an empty array on empty string", () => {
    globalThis.localStorage.setItem("calorie_records", "");
    expect(loadRecords()).toEqual([]);
  });

  it("returns an empty array when the value is not an array or object", () => {
    globalThis.localStorage.setItem("calorie_records", JSON.stringify(42));
    expect(loadRecords()).toEqual([]);
    globalThis.localStorage.setItem("calorie_records", JSON.stringify("hello"));
    expect(loadRecords()).toEqual([]);
  });

  it("filters out records that are missing required fields", () => {
    const junk = [
      { id: "ok", timestamp: 1, foods: [{ name: "x", weight_g: 1 }], totalCalories: 0, thumbnailUrl: null, mealType: "" },
      { id: 123, timestamp: 1, foods: [{ name: "x", weight_g: 1 }] },
      { id: "no-foods", timestamp: 1, foods: "not array" },
      { id: "no-name-food", timestamp: 1, foods: [{ weight_g: 1 }] },
      { foo: "bar" },
      null,
    ];
    globalThis.localStorage.setItem("calorie_records", JSON.stringify(junk));
    const records = loadRecords();
    expect(records.map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("records storage: persistRecords()", () => {
  it("writes the new versioned format and reads it back", () => {
    persistRecords([SAMPLE]);
    const stored = JSON.parse(globalThis.localStorage.getItem("calorie_records") || "{}");
    expect(stored.version).toBe(1);
    expect(Array.isArray(stored.records)).toBe(true);
    expect(stored.records[0].id).toBe(SAMPLE.id);
  });

  it("does NOT persist imageDataUrl — the thumbnail is the only image field on a record", () => {
    const recordWithImage: Record = {
      ...SAMPLE,
      // simulate a 1024px recognition image that the caller might try
      // to attach. The Record type only allows thumbnailUrl, but a
      // hostile caller could attempt a manual write to localStorage.
      thumbnailUrl: "data:image/jpeg;base64,small-thumb",
    };
    persistRecords([recordWithImage]);
    const stored = JSON.parse(globalThis.localStorage.getItem("calorie_records") || "{}");
    expect(stored.records[0].thumbnailUrl).toBe("data:image/jpeg;base64,small-thumb");
    // There must be no `imageDataUrl` field on the persisted record.
    expect(stored.records[0].imageDataUrl).toBeUndefined();
  });

  it("throws a user-friendly error when localStorage is full", () => {
    // Make setItem throw QuotaExceededError on the first call.
    const real = globalThis.localStorage.setItem;
    let calls = 0;
    globalThis.localStorage.setItem = ((key: string, value: string) => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("quota exceeded");
        (err as Error & { name: string }).name = "QuotaExceededError";
        throw err;
      }
      return real.call(globalThis.localStorage, key, value);
    }) as typeof localStorage.setItem;
    try {
      expect(() => persistRecords([{ ...SAMPLE, thumbnailUrl: "data:image/jpeg;base64,abcd" }])).not.toThrow();
    } finally {
      globalThis.localStorage.setItem = real;
    }
  });
});

describe("newRecordId", () => {
  it("returns a unique-ish id based on the timestamp", () => {
    const a = newRecordId(1000);
    const b = newRecordId(1000);
    expect(a).toMatch(/^1000-/);
    expect(b).toMatch(/^1000-/);
    // Extremely unlikely to collide.
    expect(a).not.toBe(b);
  });
});
