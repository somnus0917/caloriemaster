import { useState } from "react";
import type { Record } from "../types";
import { FoodCard } from "../components/recognition/FoodCard";
import { calculateFoodCalories } from "../utils/validation";
import { formatRecordDateTime } from "../utils/dates";

interface EditPageProps {
  record: Record;
  onSave: (id: string, weights: number[]) => void;
  onBack: () => void;
  saving: boolean;
}

export function EditPage({ record, onSave, onBack, saving }: EditPageProps) {
  const [weights, setWeights] = useState<number[]>(
    record.foods.map((f) => f.weight_g)
  );

  const total = record.foods.reduce(
    (sum, food, i) => sum + calculateFoodCalories(food, weights[i] ?? food.weight_g),
    0
  );

  const handleWeightChange = (index: number, weight: number) => {
    setWeights((prev) => {
      const next = [...prev];
      next[index] = weight;
      return next;
    });
  };

  const handleSave = () => {
    onSave(record.id, weights);
  };

  return (
    <main className="screen active">
      <section className="edit-header">
        <div className="row">
          <button className="btn-ghost" type="button" onClick={onBack}>
            ← 取消
          </button>
          <div className="screen-title">编辑记录</div>
          <button
            className="btn-ghost"
            type="button"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
        <div className="edit-info">
          <span className="meal-pill">{record.mealType}</span>
          <span className="edit-time">{formatRecordDateTime(record.timestamp)}</span>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="text-sm" style={{ color: "var(--c-muted)" }}>
            本餐合计
          </span>
          <strong>
            <span>{total}</span> kcal
          </strong>
        </div>
      </section>

      <div className="edit-foods">
        {record.foods.map((food, index) => (
          <FoodCard
            key={`${food.name}-${index}`}
            food={food}
            weight={weights[index] ?? food.weight_g}
            aiWeight={food.weight_g}
            onWeightChange={(w) => handleWeightChange(index, w)}
            editMode
          />
        ))}
      </div>

      <button
        className="btn-solid"
        type="button"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "保存中..." : "保存修改"}
      </button>
    </main>
  );
}