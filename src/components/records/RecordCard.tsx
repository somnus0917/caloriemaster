import { useState } from "react";
import type { Record } from "../../types";
import { formatRecordDate, formatRecordTime } from "../../utils/dates";

interface RecordCardProps {
  record: Record;
  today: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

function getThumbLetter(record: Record): string {
  const name = record.foods[0]?.name || "饭";
  return name.trim().charAt(0) || "饭";
}

function getBooheeThumb(record: Record): string {
  return record.foods.find((f) => f.food_image_url)?.food_image_url || "";
}

export function RecordCard({ record, today, onEdit, onDelete }: RecordCardProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const booheeThumb = getBooheeThumb(record);
  const useImage = record.thumbnailUrl || booheeThumb;
  const showImage = useImage && !imgFailed;

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
      {showImage ? (
        <img
          className="thumb thumb-fallback-letter"
          src={useImage}
          alt={`${record.mealType}缩略图`}
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="thumb thumb-letter">{getThumbLetter(record)}</div>
      )}
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
