import { useEffect, useState } from "react";

interface LoadingOverlayProps {
  show: boolean;
  text?: string;
  /**
   * Optional status string used as a default text. Recognized values
   * map to the legacy Chinese copy; anything else is shown verbatim.
   */
  stage?: "recognizing" | "enriching" | string;
}

const STAGE_TEXT: Record<string, string> = {
  recognizing: "正在识别食物…",
  enriching: "正在匹配营养数据库…",
};

const STAGE_HINT: Record<string, string> = {
  recognizing: "通常需要 2~4 秒",
  enriching: "正在补充营养信息",
};

const FALLBACK_STAGES: { after: number; text: string }[] = [
  { after: 0, text: "AI 正在识别食物..." },
  { after: 1000, text: "正在估算克重和热量..." },
  { after: 2500, text: "正在查询营养数据库..." },
];

export function LoadingOverlay({ show, text, stage }: LoadingOverlayProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!show) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 200);
    return () => clearInterval(timer);
  }, [show]);

  if (!show) return null;

  const explicitText = typeof text === "string" && text.length > 0 ? text : null;
  const stageText = stage ? STAGE_TEXT[stage] : undefined;
  const stageHint = stage ? STAGE_HINT[stage] : undefined;
  const fallback = FALLBACK_STAGES.reduce<string>(
    (acc, item) => (elapsed >= item.after ? item.text : acc),
    FALLBACK_STAGES[0].text,
  );
  const displayText = explicitText ?? stageText ?? fallback;
  const displayHint = stageHint ?? "通常需要 2~4 秒";

  return (
    <div className="modal show" id="loading-overlay" role="alert" aria-busy="true">
      <div className="loading-card">
        <div className="spinner" />
        <p>{displayText}</p>
        <p className="text-xs" style={{ color: "var(--c-muted)" }}>
          {displayHint}
        </p>
      </div>
    </div>
  );
}
