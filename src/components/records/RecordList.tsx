import { useRef, type PointerEvent } from "react";
import type { Record } from "../../types";
import { RecordCard } from "./RecordCard";

interface RecordListProps {
  records: Record[];
  today: boolean;
  emptyState?: React.ReactNode;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

interface SwipeState {
  id: string;
  startX: number;
  currentX: number;
  active: boolean;
}

const SWIPE_THRESHOLD = 72;
const SWIPE_MAX = 88;

export function RecordList({
  records,
  today,
  emptyState,
  onEdit,
  onDelete,
}: RecordListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const swipeRef = useRef<SwipeState | null>(null);

  if (records.length === 0) {
    return <div ref={containerRef}>{emptyState}</div>;
  }

  const sorted = [...records].sort((a, b) => b.timestamp - a.timestamp);

  const handlePointerDown = (e: PointerEvent<HTMLElement>, id: string) => {
    swipeRef.current = { id, startX: e.clientX, currentX: e.clientX, active: true };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const state = swipeRef.current;
    if (!state?.active) return;
    state.currentX = e.clientX;
    const diff = Math.min(0, Math.max(-SWIPE_MAX, state.currentX - state.startX));
    (e.currentTarget as HTMLElement).style.transform = `translateX(${diff}px)`;
  };

  const handlePointerUp = (e: PointerEvent<HTMLElement>) => {
    const state = swipeRef.current;
    if (!state) return;
    const diff = state.currentX - state.startX;
    (e.currentTarget as HTMLElement).style.transform = "";
    if (diff < -SWIPE_THRESHOLD) {
      onDelete(state.id);
    }
    swipeRef.current = null;
  };

  return (
    <div ref={containerRef}>
      {sorted.map((record) => (
        <div
          key={record.id}
          onPointerDown={(e) => handlePointerDown(e, record.id)}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ touchAction: "pan-y" }}
        >
          <RecordCard
            record={record}
            today={today}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </div>
      ))}
    </div>
  );
}
