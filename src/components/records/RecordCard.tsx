import type { Record } from "../../types";
import { formatRecordDate, formatRecordTime } from "../../utils/dates";
import { RecordThumbnail } from "./RecordThumbnail";

interface RecordCardProps {
  record: Record;
  today: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function RecordCard({ record, today, onEdit, onDelete }: RecordCardProps) {
  const foodsText = record.foods
    .map((f) => `${f.name} ${f.weight_g}g`)
    .join(" · ");

  return (
    <article
      className="card record-card"
      data-record-id={record.id}
      data-testid="record-card"
      onContextMenu={(e) => {
        e.preventDefault();
        if (window.confirm("删除这条记录？")) onDelete(record.id);
      }}
    >
      <RecordThumbnail
        record={{
          id: record.id,
          hasImage: record.hasImage,
          imageMimeType: record.imageMimeType ?? null,
          thumbnailUrl: record.thumbnailUrl,
          foods: record.foods,
        }}
        alt={`${record.mealType}缩略图`}
      />
      <div className="record-main">
        <div className="record-title">
          <span>{formatRecordTime(record.timestamp)}</span>
          <span>{record.mealType}</span>
          {record.isDemo ? (
            <span className="demo-badge" title="演示数据">演示</span>
          ) : null}
        </div>
        <div className="record-foods">{foodsText}</div>
        {!today ? (
          <div className="history-date">{formatRecordDate(record.timestamp)}</div>
        ) : null}
      </div>
      <div className="record-actions">
        <div className="record-cal">{record.totalCalories}</div>
        <div className="record-btns">
          <button
            className="btn-ghost btn-sm"
            type="button"
            onClick={() => onEdit(record.id)}
            aria-label="编辑"
          >
            编辑
          </button>
          <button
            className="btn-ghost btn-sm"
            type="button"
            onClick={() => onDelete(record.id)}
            aria-label="删除"
          >
            删除
          </button>
        </div>
      </div>
    </article>
  );
}
