import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import type { Settings } from "../../types";

interface SetupModalProps {
  open: boolean;
  settings: Settings;
  onSave: (next: Partial<Settings>) => void;
  onClose: () => void;
  onDemo: () => void;
}

/**
 * Settings modal — goal / limit only.
 *
 * API keys are no longer entered here. They live in `.env` on the server
 * and are injected into Qwen / 薄荷 requests by the /api/* proxy. The
 * browser never sees the raw keys.
 */
export function SetupModal({ open, settings, onSave, onClose, onDemo }: SetupModalProps) {
  const [goal, setGoal] = useState(settings.dailyGoal);
  const [limit, setLimit] = useState(settings.dailyLimit);

  useEffect(() => {
    if (!open) return;
    setGoal(settings.dailyGoal);
    setLimit(settings.dailyLimit);
  }, [open, settings]);

  const handleSave = () => {
    onSave({ dailyGoal: goal, dailyLimit: limit });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} ariaLabel="设置">
      <h2>设置</h2>
      <p>调整每日目标与上限。API Key 存放在服务器 .env，浏览器不再需要输入。</p>

      <label htmlFor="daily-goal-input">每日目标 kcal</label>
      <input
        id="daily-goal-input"
        type="number"
        min={800}
        max={6000}
        step={50}
        className="goal-input"
        value={goal}
        onChange={(e) => setGoal(Number(e.target.value))}
      />

      <label htmlFor="daily-limit-input">每日摄入上限 kcal</label>
      <input
        id="daily-limit-input"
        type="number"
        min={800}
        max={8000}
        step={50}
        className="goal-input"
        value={limit}
        onChange={(e) => setLimit(Number(e.target.value))}
      />

      <div className="field-hint">
        API Key 已在 <code>.env</code> 中配置（位于仓库根目录、已加入
        <code>.gitignore</code>，不会上传到 GitHub）。
      </div>

      <div className="modal-actions">
        <button className="btn-ghost" type="button" onClick={onClose}>
          取消
        </button>
        <button className="btn-ghost" type="button" onClick={onDemo}>
          体验演示
        </button>
        <button className="btn-primary" type="button" onClick={handleSave}>
          保存
        </button>
      </div>
    </Modal>
  );
}
