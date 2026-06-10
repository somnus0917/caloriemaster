// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  sanitizeCaloriesPer100g,
  sanitizeConfidence,
  sanitizeHealthLight,
  sanitizeName,
  sanitizeOptionalNumber,
  sanitizeWeight,
} from "../src/utils/validation";
import { normalizeAiResult, parseAiContent } from "../src/services/qwen";

describe("validation utilities", () => {
  it("clamps weight into [10, 1000]", () => {
    // 0 is finite but below the floor — clamp to 10.
    expect(sanitizeWeight(0)).toBe(10);
    expect(sanitizeWeight(5)).toBe(10);
    expect(sanitizeWeight(1500)).toBe(1000);
    expect(sanitizeWeight(120)).toBe(120);
    // Non-finite values fall back to a safe default.
    expect(sanitizeWeight("abc")).toBe(100);
    expect(sanitizeWeight(NaN)).toBe(100);
  });

  it("returns 0 for negative or non-finite calories-per-100g", () => {
    expect(sanitizeCaloriesPer100g(-5)).toBe(0);
    expect(sanitizeCaloriesPer100g(NaN)).toBe(0);
    expect(sanitizeCaloriesPer100g(null)).toBe(0);
    expect(sanitizeCaloriesPer100g(200)).toBe(200);
  });

  it("distinguishes 0 from null and NaN for optional numbers", () => {
    expect(sanitizeOptionalNumber(0)).toBe(0);
    expect(sanitizeOptionalNumber(NaN)).toBeNull();
    expect(sanitizeOptionalNumber(null)).toBeNull();
    expect(sanitizeOptionalNumber(undefined)).toBeNull();
  });

  it("trims and bounds names", () => {
    expect(sanitizeName("  米饭  ")).toBe("米饭");
    const longName = "x".repeat(80);
    expect(sanitizeName(longName).length).toBe(50);
    expect(sanitizeName("")).toBe("未知食物");
    expect(sanitizeName(null)).toBe("未知食物");
  });

  it("falls back to medium confidence for unknown values", () => {
    expect(sanitizeConfidence("high")).toBe("high");
    expect(sanitizeConfidence("low")).toBe("low");
    expect(sanitizeConfidence("something")).toBe("med");
    expect(sanitizeConfidence(null)).toBe("med");
  });

  it("falls back to 0 health light for unknown values", () => {
    expect(sanitizeHealthLight(1)).toBe(1);
    expect(sanitizeHealthLight(2)).toBe(2);
    expect(sanitizeHealthLight(3)).toBe(3);
    expect(sanitizeHealthLight(5)).toBe(0);
  });
});

describe("parseAiContent", () => {
  it("parses plain JSON", () => {
    const data = parseAiContent('{"foo": 1}');
    expect(data).toEqual({ foo: 1 });
  });

  it("strips a single outermost ```json fence", () => {
    const data = parseAiContent('```json\n{"foo": 1}\n```');
    expect(data).toEqual({ foo: 1 });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseAiContent("not json")).toThrow();
  });
});

describe("normalizeAiResult", () => {
  it("accepts an empty foods array (the caller treats it as no-food)", () => {
    const result = normalizeAiResult({ foods: [] });
    expect(result.foods).toHaveLength(0);
  });

  it("rejects non-object input", () => {
    expect(() => normalizeAiResult(null)).toThrow();
    expect(() => normalizeAiResult("foo")).toThrow();
  });

  it("normalizes a valid AI result and computes totals from weight × calories", () => {
    const result = normalizeAiResult({
      foods: [
        {
          name: "  白米饭 ",
          weight_g: 150,
          calories_per_100g: 116,
          confidence: "high",
          boohee_code: "",
        },
      ],
      note: "ok",
    });
    expect(result.foods).toHaveLength(1);
    expect(result.foods[0].name).toBe("白米饭");
    expect(result.foods[0].total_calories).toBe(174);
    expect(result.total_calories).toBe(174);
  });

  it("clamps weight and falls back to med confidence for invalid fields", () => {
    const result = normalizeAiResult({
      foods: [
        {
          name: "未知",
          weight_g: 9999,
          calories_per_100g: -3,
          confidence: "blah",
        },
      ],
    });
    expect(result.foods[0].weight_g).toBe(1000);
    expect(result.foods[0].calories_per_100g).toBe(0);
    expect(result.foods[0].confidence).toBe("med");
  });
});
