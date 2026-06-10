import { useState } from "react";
import type { AdjustMode, PortionMultiplier } from "../../types";
import { clamp } from "../../utils/math";

interface WeightAdjusterProps {
  index: number;
  value: number;
  aiValue: number;
  onChange: (next: number) => void;
}

const PRESETS: { multiplier: PortionMultiplier; label: string }[] = [
  { multiplier: 0.5, label: "半份" },
  { multiplier: 1, label: "正常份" },
  { multiplier: 1.5, label: "大份" },
  { multiplier: 2, label: "双份" },
];

const STEP_DELTAS: { label: string; delta: number }[] = [
  { label: "-50g", delta: -50 },
  { label: "-10g", delta: -10 },
  { label: "-5g", delta: -5 },
  { label: "+5g", delta: 5 },
  { label: "+10g", delta: 10 },
  { label: "+50g", delta: 50 },
];

export function WeightAdjuster({ index, value, aiValue, onChange }: WeightAdjusterProps) {
  const [mode, setMode] = useState<AdjustMode>("slider");

  const apply = (raw: number) => {
    const safe = Number.isFinite(raw) ? raw : 10;
    onChange(clamp(Math.round(safe), 10, 1000));
  };

  const diff = value - aiValue;
  const diffLabel =
    Math.abs(diff) < 5
      ? "与 AI 估算一致"
      : `${diff > 0 ? "+" : ""}${diff}g（AI 估算 ${aiValue}g）`;
  const diffClass =
    Math.abs(diff) < 5
      ? "diff-same"
      : diff > 0
        ? "diff-up"
        : "diff-down";

  const activePreset = PRESETS.find(
    (p) => Math.abs(aiValue * p.multiplier - value) < 0.5,
  )?.multiplier;

  return (
    <div data-testid={`weight-adjuster-${index}`}>
      <div className="adjust-tabs" role="tablist" aria-label="克重调整方式">
        {(["slider", "stepper", "input"] as AdjustMode[]).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`btn-ghost adjust-tab${mode === m ? " active" : ""}`}
            onClick={() => setMode(m)}
          >
            {m === "slider" ? "滑块" : m === "stepper" ? "步进" : "输入"}
          </button>
        ))}
      </div>

      {mode === "slider" && (
        <div className="adjust-pane adjust-slider">
          <input
            type="range"
            min={30}
            max={400}
            step={10}
            value={Math.min(400, Math.max(30, value))}
            onChange={(e) => apply(Number(e.target.value))}
            aria-label="克重滑块"
          />
          <div className="slider-footer">
            <span className="ai-ref">AI 估算 {aiValue}g</span>
            <span className="weight-display">{value}g</span>
          </div>
        </div>
      )}

      {mode === "stepper" && (
        <div className="adjust-pane adjust-stepper">
          {STEP_DELTAS.map((step) => (
            <button
              key={step.label}
              type="button"
              className="btn-ghost"
              onClick={() => apply(value + step.delta)}
            >
              {step.label}
            </button>
          ))}
          <span className="step-weight-display">{value}g</span>
        </div>
      )}

      {mode === "input" && (
        <div className="adjust-pane adjust-input">
          <input
            type="number"
            min={10}
            max={1000}
            value={value}
            onChange={(e) => apply(Number(e.target.value))}
            aria-label="克重"
          />
          <span>克</span>
        </div>
      )}

      <div className="portion-presets" role="group" aria-label="份量预设">
        {PRESETS.map((preset) => (
          <button
            key={preset.multiplier}
            type="button"
            className={`btn-ghost${activePreset === preset.multiplier ? " active" : ""}`}
            onClick={() => apply(Math.round(aiValue * preset.multiplier))}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className={`diff-indicator ${diffClass}`}>{diffLabel}</div>
    </div>
  );
}
