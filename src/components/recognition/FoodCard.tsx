import type { Food } from "../../types";
import { calculateFoodCalories } from "../../utils/validation";
import { WeightAdjuster } from "./WeightAdjuster";

interface FoodCardProps {
  food: Food;
  weight: number;
  aiWeight: number;
  onWeightChange: (next: number) => void;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "高置信",
  med: "中置信",
  low: "低置信",
};

const LIGHT_LABEL: Record<string, string> = {
  "1": "绿灯",
  "2": "黄灯",
  "3": "红灯",
};

function formatMacro(label: string, value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${label} ${value.toFixed(1)}g/100g`;
}

export function FoodCard({ food, weight, aiWeight, onWeightChange }: FoodCardProps) {
  const calories = calculateFoodCalories(food, weight);
  const sourceText = food.cal_source === "boohee" ? "薄荷数据" : "AI 估算";
  const lightText = LIGHT_LABEL[String(food.health_light ?? 0)] || "无红绿灯";
  const macros = [
    formatMacro("蛋白", food.protein_per_100g),
    formatMacro("脂肪", food.fat_per_100g),
    formatMacro("碳水", food.carbohydrate_per_100g),
  ]
    .filter(Boolean)
    .map((m) => (
      <span key={m} className="meta-chip">
        {m}
      </span>
    ));

  return (
    <div className="card food-card">
      <div className="food-header">
        <span className="food-name" title={food.name}>
          {food.name}
        </span>
        <span className={`badge badge-${food.confidence}`}>
          {CONFIDENCE_LABEL[food.confidence] || "中置信"}
        </span>
        <span className="calories">
          <span className="cal-num">{calories}</span> kcal
        </span>
      </div>
      <div className="food-meta">
        <span
          className={`meta-chip${food.cal_source === "boohee" ? " source-boohee" : ""}`}
        >
          {sourceText} · {Math.round(food.calories_per_100g)} kcal/100g
        </span>
        <span className={`meta-chip light-${food.health_light ?? 0}`}>{lightText}</span>
        {macros}
      </div>
      <WeightAdjuster
        value={weight}
        aiValue={aiWeight}
        onChange={onWeightChange}
      />
    </div>
  );
}
