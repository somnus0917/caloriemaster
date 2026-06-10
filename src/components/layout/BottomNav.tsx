interface BottomNavProps {
  onHome: () => void;
  onHistory: () => void;
}

export function BottomNav({ onHome, onHistory }: BottomNavProps) {
  return (
    <div className="bottom-bar">
      <button className="btn-primary" type="button" onClick={onHome}>
        首页
      </button>
      <button className="btn-primary" type="button" onClick={onHistory}>
        历史
      </button>
    </div>
  );
}
