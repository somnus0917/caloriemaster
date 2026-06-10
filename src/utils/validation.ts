import type { Food } from "../types";
import { clamp, isFiniteNumber } from "./math";

const NAME_MAX = 50;
const WEIGHT_MIN = 10;
const WEIGHT_MAX = 1000;

export function sanitizeName(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length === 0 ? "未知食物" : s.slice(0, NAME_MAX);
}

export function sanitizeWeight(raw: unknown): number {
  if (!isFiniteNumber(raw)) return 100;
  return clamp(Math.round(raw), WEIGHT_MIN, WEIGHT_MAX);
}

export function sanitizeCaloriesPer100g(raw: unknown): number {
  if (!isFiniteNumber(raw)) return 0;
  return Math.max(0, raw);
}

export function sanitizeConfidence(raw: unknown): "high" | "med" | "low" {
  return raw === "high" || raw === "med" || raw === "low" ? raw : "med";
}

export function sanitizeOptionalNumber(raw: unknown): number | null {
  return isFiniteNumber(raw) ? raw : null;
}

export function sanitizeHealthLight(raw: unknown): 0 | 1 | 2 | 3 {
  if (raw === 1 || raw === 2 || raw === 3) return raw;
  return 0;
}

export function computeTotalCalories(
  caloriesPer100g: number,
  weightG: number,
): number {
  return Math.round((caloriesPer100g * weightG) / 100);
}

export function calculateFoodCalories(food: Food, weightG: number): number {
  return computeTotalCalories(food.calories_per_100g, weightG);
}
