import type { PortionMultiplier } from "../../types";
import { clamp } from "../../utils/math";

interface WeightAdjusterProps {
  value: number;
  aiValue: number;
  onChange: (next: number) => void;
}

const STEP = 10;
const SLIDER_MIN = 10;
const SLIDER_MAX_FLOOR = 800;
const HARD_MAX = 1000;
const HARD_MIN = 10;

const PRESETS: { multiplier: PortionMultiplier; label: string }[] = [
  { multiplier: 0.5, label: "半份" },
  { multiplier: 1, label: "正常份" },
  { multiplier: 1.5, label: "大份" },
  { multiplier: 2, label: "双份" },
];

function safe(value: number): number {
  return clamp(Math.round(value), HARD_MIN, HARD_MAX);
}

export function WeightAdjuster({ value, aiValue, onChange }: WeightAdjusterProps) {
  const sliderMax = Math.max(SLIDER_MAX_FLOOR, Math.ceil(aiValue * 2));
  const diff = value - aiValue;
  const diffClass =
    Math.abs(diff) < 5 ? "diff-same" : diff > 0 ? "diff-up" : "diff-down";
  const diffText =
    Math.abs(diff) < 5
      ? "与 AI 估算一致"
      : `${diff > 0 ? "+" : ""}${diff}g（AI 估算 ${aiValue}g）`;

  const activePresetMultiplier = PRESETS.find(
    (p) => Math.abs(aiValue * p.multiplier - value) < 0.5,
  )?.multiplier;

  return (
    <div className="weight-adjuster" data-testid="weight-adjuster">
      <div className="weight-stepper">
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(safe(value - STEP))}
          aria-label={`减少 ${STEP} 克`}
        >
          −
        </button>
        <div className="weight-display">
          <span className="weight-num">{value}</span>
          <span className="weight-unit">g</span>
        </div>
        <button
          type="button"
          className="stepper-btn"
          onClick={() => onChange(safe(value + STEP))}
          aria-label={`增加 ${STEP} 克`}
        >
          +
        </button>
      </div>

      <input
        type="range"
        className="weight-slider"
        min={SLIDER_MIN}
        max={sliderMax}
        step={5}
        value={clamp(value, SLIDER_MIN, sliderMax)}
        onChange={(e) => onChange(safe(Number(e.target.value)))}
        aria-label="克重滑块"
      />

      <div className="portion-row" role="group" aria-label="份量预设">
        {PRESETS.map((preset) => (
          <button
            key={preset.multiplier}
            type="button"
            className={`portion-chip${
              activePresetMultiplier === preset.multiplier ? " active" : ""
            }`}
            onClick={() => onChange(safe(aiValue * preset.multiplier))}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className={`diff-indicator ${diffClass}`}>{diffText}</div>
    </div>
  );
}
