interface BottomNavProps {
  active: "home" | "history";
  onHome: () => void;
  onHistory: () => void;
}

export function BottomNav({ active, onHome, onHistory }: BottomNavProps) {
  return (
    <div className="bottom-bar">
      <button
        className={`bottom-tab ${active === "home" ? "active" : ""}`}
        type="button"
        onClick={onHome}
        aria-current={active === "home" ? "page" : undefined}
      >
        <span aria-hidden="true">⌂</span>
        首页
      </button>
      <button
        className={`bottom-tab ${active === "history" ? "active" : ""}`}
        type="button"
        onClick={onHistory}
        aria-current={active === "history" ? "page" : undefined}
      >
        <span aria-hidden="true">▥</span>
        历史
      </button>
    </div>
  );
}
