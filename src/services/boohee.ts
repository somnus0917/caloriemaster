import type { Food, RecognitionResult } from "../types";
import { computeTotalCalories } from "../utils/validation";
import { fetchWithTimeout } from "./http";
import { lookupBooheeCode } from "../data/booheeFoods";

export interface BooheeDetail {
  name: string;
  code: string;
  calories_per_100g: number;
  protein_per_100g: number | null;
  fat_per_100g: number | null;
  carbohydrate_per_100g: number | null;
  health_light: 0 | 1 | 2 | 3;
  image_url: string;
  source: "boohee";
}

interface RawBoohee {
  code?: unknown;
  data?: RawSource;
  food?: RawSource;
  name?: unknown;
}

interface RawSource {
  name?: unknown;
  code?: unknown;
  calory?: unknown;
  calories?: { value?: unknown };
  protein?: { value?: unknown };
  fat?: { value?: unknown };
  carbohydrate?: { value?: unknown };
  health_light?: unknown;
  image_url?: unknown;
  thumb_image_url?: unknown;
  thumb_img_url?: unknown;
  food?: { code?: unknown; name?: unknown; thumb_image_url?: unknown };
  ingredients?: Array<{ key?: unknown; name_en?: unknown; value?: unknown }>;
  base_ingredients?: Array<{ key?: unknown; name_en?: unknown; value?: unknown }>;
  vitamin?: Array<{ key?: unknown; name_en?: unknown; value?: unknown }>;
  mineral?: Array<{ key?: unknown; name_en?: unknown; value?: unknown }>;
  other_ingredients?: Array<{ key?: unknown; name_en?: unknown; value?: unknown }>;
}

function findIngredient(source: RawSource, key: string): number | null {
  const groups = [
    source.ingredients,
    source.base_ingredients,
    source.vitamin,
    source.mineral,
    source.other_ingredients,
  ].filter(Array.isArray) as Array<Array<{ key?: unknown; name_en?: unknown; value?: unknown }>>;
  for (const group of groups) {
    const item = group.find(
      (entry) => entry.key === key || entry.name_en === key,
    );
    if (item && Number(item.value)) return Number(item.value);
  }
  return null;
}

export function parseBooheeNutrition(data: RawBoohee, fallbackName: string): BooheeDetail | null {
  const source = data?.data || data?.food || (data as RawSource);
  if (!source || typeof source !== "object") return null;
  const calories =
    Number(source.calories?.value) ||
    Number(source.calory) ||
    (Array.isArray(source.calory)
      ? Number(
          source.calory.find((item) => (item as { name_en?: string }).name_en === "total_calory")
            ?.value,
        )
      : 0);
  if (!Number.isFinite(calories) || calories <= 0) return null;
  return {
    name: (source.name as string) || (source.food?.name as string) || fallbackName,
    code: (source.code as string) || (source.food?.code as string) || "",
    calories_per_100g: calories,
    protein_per_100g: Number(source.protein?.value) || findIngredient(source, "protein"),
    fat_per_100g: Number(source.fat?.value) || findIngredient(source, "fat"),
    carbohydrate_per_100g:
      Number(source.carbohydrate?.value) || findIngredient(source, "carbohydrate"),
    health_light:
      source.health_light === 1 || source.health_light === 2 || source.health_light === 3
        ? source.health_light
        : 0,
    image_url:
      (source.image_url as string) ||
      (source.thumb_image_url as string) ||
      (source.thumb_img_url as string) ||
      (source.food?.thumb_image_url as string) ||
      "",
    source: "boohee",
  };
}

/**
 * Call 薄荷 through the local /api/boohee proxy. The proxy holds
 * BOOHEE_API_KEY (loaded from .env on the server) and forwards the request.
 */
export async function queryBooheeDetail(
  code: string,
  fallbackName: string,
  timeoutMs?: number,
): Promise<BooheeDetail | null> {
  if (!code) return null;
  let response: Response;
  try {
    response = await fetchWithTimeout(
      `/api/boohee?code=${encodeURIComponent(code)}`,
      { timeoutMs },
    );
  } catch (error) {
    console.warn("[boohee] proxy fetch failed:", (error as Error).message);
    return null;
  }
  if (!response.ok) {
    if (response.status === 503) {
      // Server doesn't have BOOHEE_API_KEY configured — silently fall back.
      return null;
    }
    return null;
  }
  let data: { code?: number } & RawBoohee;
  try {
    data = (await response.json()) as { code?: number } & RawBoohee;
  } catch {
    return null;
  }
  if (data.code === 0 || data.data || data.food) {
    return parseBooheeNutrition(data, fallbackName);
  }
  return null;
}

export async function enrichWithDatabase(
  result: RecognitionResult,
): Promise<RecognitionResult> {
  const enriched = await Promise.all(
    result.foods.map(async (food) => {
      const localHit = lookupBooheeCode(food.name);
      const resolvedCode = localHit?.code || food.boohee_code || "";
      const canonicalName = localHit?.canonicalName || food.name;

      if (!resolvedCode) {
        return { ...food, cal_source: "ai_estimate" as const };
      }
      const dbData = await queryBooheeDetail(resolvedCode, canonicalName);
      if (dbData?.calories_per_100g) {
        return {
          ...food,
          name: dbData.name || canonicalName,
          boohee_code: dbData.code || resolvedCode,
          calories_per_100g: dbData.calories_per_100g,
          total_calories: computeTotalCalories(dbData.calories_per_100g, food.weight_g),
          protein_per_100g: dbData.protein_per_100g,
          fat_per_100g: dbData.fat_per_100g,
          carbohydrate_per_100g: dbData.carbohydrate_per_100g,
          health_light: dbData.health_light,
          food_image_url: dbData.image_url,
          cal_source: "boohee" as const,
        };
      }
      return {
        ...food,
        name: canonicalName,
        boohee_code: resolvedCode,
        cal_source: localHit ? ("local_lookup_miss" as const) : ("ai_estimate" as const),
      };
    }),
  );
  return {
    ...result,
    foods: enriched,
    total_calories: enriched.reduce((s, f) => s + f.total_calories, 0),
  };
}

export type { Food };
