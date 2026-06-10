import type { Food, RecognitionResult } from "../types";
import {
  computeTotalCalories,
  sanitizeCaloriesPer100g,
  sanitizeConfidence,
  sanitizeHealthLight,
  sanitizeName,
  sanitizeOptionalNumber,
  sanitizeWeight,
} from "../utils/validation";
import { fetchWithTimeout, readApiError } from "./http";

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
  if (!Array.isArray(result.foods) || result.foods.length === 0) {
    throw new Error("AI 返回格式异常");
  }
  const foods = result.foods
    .map((f) => (f && typeof f === "object" ? normalizeFood(f as RawFood) : null))
    .filter((f): f is Food => f !== null);
  if (foods.length === 0) {
    throw new Error("AI 返回格式异常");
  }
  return {
    foods,
    total_calories: foods.reduce((s, f) => s + f.total_calories, 0),
    note: typeof result.note === "string" ? result.note : "",
  };
}

/**
 * Parse a JSON string from the model, optionally wrapped in a single
 * ```json ... ``` fence. The previous implementation used a greedy
 * regex which could swallow too much; this version prefers JSON.parse
 * and only strips the outermost fence.
 */
export function parseAiContent(content: string): unknown {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const target = fence ? fence[1] : trimmed;
  return JSON.parse(target);
}

export interface RecognizeOptions {
  imageBase64: string;
  timeoutMs?: number;
}

/**
 * Call the local food-recognition proxy. The browser sends ONLY the
 * image; the system prompt, model name, and generation parameters are
 * all fixed on the server side (see server/validation.cjs).
 */
export async function recognizeFood({
  imageBase64,
  timeoutMs,
}: RecognizeOptions): Promise<RecognitionResult> {
  const response = await fetchWithTimeout(
    "/api/recognize-food",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // IMPORTANT: the body intentionally has no other fields. Adding
      // `messages`, `model`, `response_format`, etc. would not help
      // — the server builds the upstream request from scratch and
      // would simply ignore them. We still don't send them, to keep
      // the wire contract minimal.
      body: JSON.stringify({ imageBase64 }),
      timeoutMs,
    },
  );

  if (!response.ok) {
    throw await readApiError(response);
  }

  const data = (await response.json()) as { content?: unknown };
  const content = typeof data.content === "string" ? data.content : "";
  if (!content) {
    throw new Error("AI 返回格式异常");
  }
  let parsed: unknown;
  try {
    parsed = parseAiContent(content);
  } catch {
    throw new Error("AI 返回格式异常");
  }
  return normalizeAiResult(parsed);
}
