/**
 * Food recognition client. Sends ONLY the image; the server builds the
 * upstream Qwen request (system prompt, model, params) itself.
 */
import type { Food, RecognitionResult } from "../types";
import {
  computeTotalCalories,
  sanitizeCaloriesPer100g,
  sanitizeConfidence,
  sanitizeHealthLight,
  sanitizeName,
  sanitizeOptionalNumber,
  sanitizeWeight,
} from "../utils/validation.js";
import { ApiError, apiRequest } from "./http.js";

interface RawFood {
  name?: unknown;
  weight_g?: unknown;
  calories_per_100g?: unknown;
  total_calories?: unknown;
  boohee_code?: unknown;
  code?: unknown;
  confidence?: unknown;
  cal_source?: unknown;
  protein_per_100g?: unknown;
  fat_per_100g?: unknown;
  carbohydrate_per_100g?: unknown;
  health_light?: unknown;
}

function normalizeFood(raw: RawFood): Food {
  const weight = sanitizeWeight(raw.weight_g);
  const caloriesPer100g = sanitizeCaloriesPer100g(raw.calories_per_100g);
  const code = typeof raw.boohee_code === "string"
    ? raw.boohee_code
    : typeof raw.code === "string"
      ? raw.code
      : "";
  return {
    name: sanitizeName(raw.name),
    weight_g: weight,
    calories_per_100g: caloriesPer100g,
    total_calories: computeTotalCalories(caloriesPer100g, weight),
    boohee_code: code,
    confidence: sanitizeConfidence(raw.confidence),
    cal_source:
      raw.cal_source === "boohee" || raw.cal_source === "local_lookup_miss"
        ? raw.cal_source
        : "ai_estimate",
    protein_per_100g: sanitizeOptionalNumber(raw.protein_per_100g),
    fat_per_100g: sanitizeOptionalNumber(raw.fat_per_100g),
    carbohydrate_per_100g: sanitizeOptionalNumber(raw.carbohydrate_per_100g),
    health_light: sanitizeHealthLight(raw.health_light),
  };
}

export function normalizeAiResult(parsed: unknown): RecognitionResult {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI 返回格式异常");
  }
  const result = parsed as { foods?: unknown; note?: unknown };
  if (!Array.isArray(result.foods)) {
    throw new Error("AI 返回格式异常");
  }
  const foods = result.foods
    .map((f) => (f && typeof f === "object" ? normalizeFood(f as RawFood) : null))
    .filter((f): f is Food => f !== null);
  return {
    foods,
    total_calories: foods.reduce((s, f) => s + f.total_calories, 0),
    note: typeof result.note === "string" ? result.note : "",
  };
}

export function parseAiContent(content: string): unknown {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const target = fence ? fence[1] : trimmed;
  return JSON.parse(target);
}

export type RecognizeOutcome = { ok: true; result: RecognitionResult } | { ok: false; reason: "no_food" | "error"; message?: string };

export async function recognizeFood({
  imageBase64,
  timeoutMs,
}: {
  imageBase64: string;
  timeoutMs?: number;
}): Promise<RecognizeOutcome> {
  let content = "";
  try {
    const data = await apiRequest<{ content: string }>("/api/recognize-food", {
      method: "POST",
      body: { imageBase64 },
      timeoutMs,
    });
    content = typeof data.content === "string" ? data.content : "";
  } catch (err) {
    if (err instanceof ApiError && err.code === "NO_FOOD_DETECTED") {
      return { ok: false, reason: "no_food" };
    }
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : "识别失败" };
  }
  if (!content) {
    return { ok: false, reason: "error", message: "AI 返回格式异常" };
  }
  let parsed: unknown;
  try {
    parsed = parseAiContent(content);
  } catch {
    return { ok: false, reason: "error", message: "AI 返回格式异常" };
  }
  let result: RecognitionResult;
  try {
    result = normalizeAiResult(parsed);
  } catch {
    // Could be: empty foods array → NO_FOOD_DETECTED.
    return { ok: false, reason: "no_food" };
  }
  if (result.foods.length === 0) {
    return { ok: false, reason: "no_food" };
  }
  return { ok: true, result };
}
