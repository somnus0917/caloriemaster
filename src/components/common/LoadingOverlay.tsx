import { useEffect, useState } from "react";

interface LoadingOverlayProps {
  show: boolean;
  text?: string;
}

const STAGES: { after: number; text: string }[] = [
  { after: 0, text: "AI 正在识别食物..." },
  { after: 1000, text: "正在估算克重和热量..." },
  { after: 2500, text: "正在查询营养数据库..." },
];

export function LoadingOverlay({ show, text }: LoadingOverlayProps) {
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

  const stage = STAGES.reduce<string>(
    (acc, item) => (elapsed >= item.after ? item.text : acc),
    STAGES[0].text,
  );

  return (
    <div className="modal show" id="loading-overlay" role="alert" aria-busy="true">
      <div className="loading-card">
        <div className="spinner" />
        <p>{text ?? stage}</p>
        <p className="text-xs" style={{ color: "var(--c-muted)" }}>
          通常需要 2~4 秒
        </p>
      </div>
    </div>
  );
}
