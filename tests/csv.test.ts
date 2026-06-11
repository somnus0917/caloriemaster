// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildCSV } from "../src/utils/csv";
import type { Record } from "../src/types";

const records: Record[] = [
  {
    id: "r1",
    timestamp: new Date(2024, 5, 10, 12, 30).getTime(),
    mealType: "午餐",
    totalCalories: 500,
    thumbnailUrl: null,
    hasImage: false,
    hasOriginalImage: false,
    foods: [
      {
        name: "米饭",
        weight_g: 150,
        calories_per_100g: 116,
        total_calories: 174,
        confidence: "med",
        cal_source: "ai_estimate",
      },
      {
        name: "红烧肉",
        weight_g: 80,
        calories_per_100g: 478,
        total_calories: 382,
        confidence: "med",
        cal_source: "boohee",
      },
    ],
  },
];

describe("CSV export", () => {
  it("starts with UTF-8 BOM and has the expected header", () => {
    const csv = buildCSV(records);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\n");
    expect(lines[0]).toBe("日期,时间,餐次,食物,克重(g),热量(kcal),来源,演示数据");
  });

  it("emits one row per food inside each record", () => {
    const csv = buildCSV(records);
    const lines = csv.slice(1).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("米饭");
    expect(lines[2]).toContain("红烧肉");
  });

  it("escapes commas, quotes and newlines", () => {
    const csv = buildCSV([
      {
        id: "r2",
        timestamp: Date.now(),
        mealType: "加餐",
        totalCalories: 0,
        thumbnailUrl: null,
        hasImage: false,
        hasOriginalImage: false,
        foods: [
          {
            name: 'food"with"quote, and comma',
            weight_g: 50,
            calories_per_100g: 100,
            total_calories: 50,
            confidence: "low",
            cal_source: "ai_estimate",
          },
        ],
      },
    ]);
    expect(csv).toContain('"food""with""quote, and comma"');
  });
});
