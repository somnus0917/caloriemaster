import type { RecognitionResult } from "../types";
import { FoodCard } from "../components/recognition/FoodCard";
import { calculateFoodCalories } from "../utils/validation";

interface ConfirmPageProps {
  result: RecognitionResult | null;
  weights: number[];
  aiWeights: number[];
  imageDataUrl: string | null;
  note: string;
  editing: boolean;
  onWeightChange: (index: number, weight: number) => void;
  onSave: () => void;
  onBack: () => void;
  saving: boolean;
}

export function ConfirmPage({
  result,
  weights,
  aiWeights,
  imageDataUrl,
  note,
  editing,
  onWeightChange,
  onSave,
  onBack,
  saving,
}: ConfirmPageProps) {
  if (!result) {
    return (
      <main className="screen active">
        <p style={{ padding: 24, color: "var(--c-muted)" }}>没有可保存的识别结果</p>
      </main>
    );
  }

  const total = result.foods.reduce(
    (sum, food, i) => sum + calculateFoodCalories(food, weights[i] ?? food.weight_g),
    0,
  );

  return (
    <main className="screen active">
      <section className="confirm-summary">
        <div className="row">
          <button className="btn-ghost" type="button" onClick={onBack}>
            ← 重选
          </button>
          <div className="screen-title">确认克重</div>
          <button
            className="btn-ghost"
            type="button"
            onClick={onSave}
            disabled={saving}
          >
            {editing ? "更新记录" : "保存"}
          </button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="text-sm" style={{ color: "var(--c-muted)" }}>
            本餐合计
          </span>
          <strong>
            <span data-testid="total-calories">{total}</span> kcal
          </strong>
        </div>
      </section>

      {imageDataUrl ? (
        <img
          id="confirm-preview"
          className="preview-image"
          src={imageDataUrl}
          alt="食物照片预览"
        />
      ) : null}

      {note ? <div className="note-box">{note}</div> : null}

      <div>
        {result.foods.map((food, index) => (
          <FoodCard
            key={`${food.name}-${index}`}
            food={food}
            weight={weights[index] ?? food.weight_g}
            aiWeight={aiWeights[index] ?? food.weight_g}
            onWeightChange={(w) => onWeightChange(index, w)}
          />
        ))}
      </div>

      <button
        className="btn-solid"
        type="button"
        onClick={onSave}
        disabled={saving}
      >
        {editing ? "更新记录" : "保存记录"}
      </button>
    </main>
  );
}
