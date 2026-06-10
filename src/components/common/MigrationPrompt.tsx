import { useState } from "react";
import { runMigration, skipMigration } from "../../services/migrate";

interface MigrationPromptProps {
  onDone: () => void;
  onSkip: () => void;
}

export function MigrationPrompt({ onDone, onSkip }: MigrationPromptProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await runMigration();
      onDone();
      if (r.imported > 0) {
        console.info(`Imported ${r.imported} legacy record(s)`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  function handleSkip() {
    if (busy) return;
    skipMigration();
    onSkip();
  }

  return (
    <div className="modal show" role="dialog" aria-modal="true" aria-label="导入历史记录">
      <div className="modal-card">
        <h2>检测到本机历史记录</h2>
        <p>是否将这些旧记录导入到当前账户？</p>
        <p className="text-sm" style={{ color: "var(--c-muted)" }}>
          导入后将从本机删除。失败时会保留原数据，可以稍后再试。
        </p>
        {error ? (
          <div className="auth-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="btn-ghost" type="button" onClick={handleSkip} disabled={busy}>
            跳过
          </button>
          <button className="btn-primary" type="button" onClick={handleImport} disabled={busy}>
            {busy ? "导入中..." : "导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
