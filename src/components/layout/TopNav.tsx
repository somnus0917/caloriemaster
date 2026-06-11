interface TopNavProps {
  onExport: () => void;
  onSettings: () => void;
}

export function TopNav({ onExport, onSettings }: TopNavProps) {
  return (
    <header className="top-nav">
      <div>
        <div className="brand">
          卡路里追踪
          <span aria-hidden="true">⌁</span>
        </div>
        <div className="brand-subtitle">记录每一餐，掌控每一天</div>
      </div>
      <div className="nav-actions">
        <button
          className="icon-btn"
          type="button"
          onClick={onExport}
          title="导出 CSV"
          aria-label="导出 CSV"
        >
          ⇩
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
    </header>
  );
}
