import type { Food, Record } from "../types";
import { calculateFoodCalories } from "./validation";

export function sumRecordCalories(records: Record[]): number {
  return records.reduce((sum, r) => sum + r.totalCalories, 0);
}

export function totalForDay(records: Record[], date: Date): number {
  const start = new Date(date).setHours(0, 0, 0, 0);
  const end = new Date(date).setHours(23, 59, 59, 999);
  return sumRecordCalories(
    records.filter((r) => r.timestamp >= start && r.timestamp <= end),
  );
}

export function recordsForDay(records: Record[], date: Date): Record[] {
  const start = new Date(date).setHours(0, 0, 0, 0);
  const end = new Date(date).setHours(23, 59, 59, 999);
  return records.filter((r) => r.timestamp >= start && r.timestamp <= end);
}

export function buildFoodsWithWeights(
  foods: Food[],
  weights: number[],
): Food[] {
  return foods.map((food, i) => ({
    ...food,
    weight_g: weights[i],
    total_calories: calculateFoodCalories(food, weights[i]),
  }));
}

export function computeRecordTotal(foods: Food[]): number {
  return foods.reduce((sum, food) => sum + food.total_calories, 0);
}
