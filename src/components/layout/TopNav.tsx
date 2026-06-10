interface TopNavProps {
  onExport: () => void;
  onSettings: () => void;
}

export function TopNav({ onExport, onSettings }: TopNavProps) {
  return (
    <nav className="top-nav">
      <div className="brand">卡路里追踪</div>
      <div className="nav-actions">
        <button
          className="icon-btn"
          type="button"
          onClick={onExport}
          title="导出 CSV"
          aria-label="导出 CSV"
        >
          ⬇
        </button>
        <button
          className="icon-btn"
          type="button"
          onClick={onSettings}
          title="设置"
          aria-label="设置"
        >
          ⚙
        </button>
      </div>
    </nav>
  );
}
