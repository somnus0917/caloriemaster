// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildDemoWeek, DEMO_RECOGNITION } from "../src/data/demoData";
import { lookupBooheeCode } from "../src/data/booheeFoods";

describe("demo data", () => {
  it("builds 7-day demo records with valid numeric fields", () => {
    const records = buildDemoWeek();
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(Number.isFinite(record.totalCalories)).toBe(true);
      expect(record.totalCalories).toBeGreaterThanOrEqual(0);
      expect(record.isDemo).toBe(true);
      for (const food of record.foods) {
        expect(Number.isFinite(food.weight_g)).toBe(true);
        expect(food.weight_g).toBeGreaterThan(0);
        expect(Number.isFinite(food.calories_per_100g)).toBe(true);
        expect(food.calories_per_100g).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(food.total_calories)).toBe(true);
        expect(food.total_calories).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("computes per-record total from per-food totals", () => {
    const records = buildDemoWeek();
    for (const record of records) {
      const sum = record.foods.reduce((s, f) => s + f.total_calories, 0);
      expect(record.totalCalories).toBe(sum);
    }
  });

  it("rebuilds calories_per_100g consistently from weight and total", () => {
    const records = buildDemoWeek();
    for (const record of records) {
      for (const food of record.foods) {
        const expected = Math.round((food.total_calories / food.weight_g) * 100);
        expect(food.calories_per_100g).toBe(expected);
      }
    }
  });

  it("provides a demo recognition payload with finite numeric values", () => {
    for (const food of DEMO_RECOGNITION.foods) {
      expect(Number.isFinite(food.weight_g)).toBe(true);
      expect(food.weight_g).toBeGreaterThan(0);
      expect(Number.isFinite(food.calories_per_100g)).toBe(true);
      expect(food.calories_per_100g).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(food.total_calories)).toBe(true);
      expect(food.total_calories).toBeGreaterThanOrEqual(0);
    }
    expect(DEMO_RECOGNITION.total_calories).toBe(
      DEMO_RECOGNITION.foods.reduce((s, f) => s + f.total_calories, 0),
    );
  });
});

describe("boohee local lookup", () => {
  it("returns exact match for known foods", () => {
    expect(lookupBooheeCode("白米饭")).toEqual({
      code: "food_1001002",
      canonicalName: "白米饭",
    });
  });

  it("strips common suffixes for known foods", () => {
    // "苹果饭" strips to "苹果" and matches the table entry.
    expect(lookupBooheeCode("苹果饭")).toEqual({
      code: "food_1005001",
      canonicalName: "苹果",
    });
  });

  it("uses contains match for dishes that embed a known ingredient", () => {
    // The dish name itself is in the table, so exact match wins.
    expect(lookupBooheeCode("西红柿炒鸡蛋")).toEqual({
      code: "food_1007006",
      canonicalName: "西红柿炒鸡蛋",
    });
    // A free-form phrase that embeds "白菜" falls back to the contains match.
    expect(lookupBooheeCode("清炒小白菜")).toEqual({
      code: "food_1004001",
      canonicalName: "白菜",
    });
  });

  it("returns null for unknown foods", () => {
    expect(lookupBooheeCode("某种外星食物")).toBeNull();
  });
});
