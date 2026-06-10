import type { Record } from "../types";
import { RecordList } from "../components/records/RecordList";

interface HistoryPageProps {
  records: Record[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}

export function HistoryPage({ records, onEdit, onDelete, onBack }: HistoryPageProps) {
  return (
    <main className="screen active">
      <div className="section-heading" style={{ marginTop: 0 }}>
        <div className="text-lg">历史记录</div>
        <button className="btn-ghost" type="button" onClick={onBack}>
          返回首页
        </button>
      </div>
      <RecordList
        records={records}
        today={false}
        onEdit={onEdit}
        onDelete={onDelete}
        emptyState={<div className="empty">暂无历史记录</div>}
      />
    </main>
  );
}
