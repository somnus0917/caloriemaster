import { useEffect, useMemo, useState } from "react";
import type { Record, Settings } from "../types";
import { isToday } from "../utils/dates";
import { sumRecordCalories, recordsForDay } from "../utils/nutrition";
import { RecordList } from "../components/records/RecordList";
import { TrendChart } from "../components/records/TrendChart";
import { Modal } from "../components/common/Modal";

interface HomePageProps {
  records: Record[];
  settings: Settings;
  onGoCamera: () => void;
  onGoHistory: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onDaySelect: (date: string) => void;
}

export function HomePage({
  records,
  settings,
  onGoCamera,
  onGoHistory,
  onEdit,
  onDelete,
  onDaySelect,
}: HomePageProps) {
  const todayRecords = useMemo(
    () => records.filter((r) => isToday(r.timestamp)),
    [records],
  );

  const todayTotal = sumRecordCalories(todayRecords);
  const { dailyGoal, dailyLimit } = settings;
  const pct = Math.min(100, Math.round((todayTotal / dailyLimit) * 100));
  const goalPct = Math.round((todayTotal / dailyGoal) * 100);
  const remaining = dailyLimit - todayTotal;
  const heroState =
    todayTotal > dailyLimit
      ? "hero-over"
      : todayTotal >= dailyGoal * 0.85
        ? "hero-warn"
        : "";

  const intakeStatus =
    todayTotal > dailyLimit
      ? `已超过上限 ${todayTotal - dailyLimit} kcal`
      : todayTotal >= dailyGoal
        ? `已达目标，距上限还剩 ${dailyLimit - todayTotal} kcal`
        : `距目标还差 ${dailyGoal - todayTotal} kcal`;

  const progressColor =
    todayTotal < dailyGoal * 0.85
      ? "var(--c-green)"
      : todayTotal <= dailyLimit
        ? "var(--c-amber)"
        : "var(--c-red)";

  const [dayModal, setDayModal] = useState<{ date: string; records: Record[] } | null>(null);

  useEffect(() => {
    if (!dayModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDayModal(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dayModal]);

  return (
    <main className="screen active">
      <section className={`hero-total ${heroState}`.trim()}>
        <div className="hero-plate" aria-hidden="true">
          <span>🥗</span>
        </div>
        <div className="total-row">
          <div>
            <div className="goal-copy goal-title">
              <span className="goal-icon" aria-hidden="true">✣</span>
              今日热量
            </div>
            <div>
              <span className="total-kcal">{todayTotal}</span> kcal
            </div>
          </div>
          <div className="goal-copy">/ 上限 {dailyLimit} kcal</div>
        </div>
        <div className="progress-track" aria-label="今日热量进度">
          <div
            className="progress-fill"
            style={{ width: `${pct}%`, background: progressColor }}
          />
        </div>
        <div className="stat-grid">
          <div className="stat-chip">
            <span className="stat-icon stat-icon-goal" aria-hidden="true">◎</span>
            <div className="stat-label">每日目标</div>
            <div className="stat-value">{dailyGoal}</div>
          </div>
          <div className="stat-chip">
            <span className="stat-icon stat-icon-limit" aria-hidden="true">◈</span>
            <div className="stat-label">摄入上限</div>
            <div className="stat-value">{dailyLimit}</div>
          </div>
          <div className="stat-chip">
            <span className="stat-icon stat-icon-left" aria-hidden="true">◔</span>
            <div className="stat-label">剩余额度</div>
            <div className="stat-value">
              {remaining >= 0 ? remaining : `+${Math.abs(remaining)}`}
            </div>
          </div>
        </div>
        <div className="status-strip">
          <span className="status-copy">
            <span aria-hidden="true">⚑</span>
            {intakeStatus}
          </span>
          <span>{goalPct}%</span>
        </div>
        <button className="btn-solid" type="button" onClick={onGoCamera}>
          <span aria-hidden="true">＋</span>
          记录一餐
        </button>
      </section>

      <section>
        <div className="section-heading">
          <div className="text-lg">今日记录</div>
          <button className="btn-ghost" type="button" onClick={onGoHistory}>
            全部历史 ›
          </button>
        </div>
        <RecordList
          records={todayRecords}
          today
          onEdit={onEdit}
          onDelete={onDelete}
          emptyState={
            <div className="empty empty-cta">
              <div className="empty-emoji">🍱</div>
              <div className="empty-title">今天还没有记录</div>
              <div className="empty-hint">拍一餐或点演示按钮就能体验完整流程</div>
              <button className="btn-solid" type="button" onClick={onGoCamera}>
                + 记录一餐
              </button>
            </div>
          }
        />
      </section>

      <section>
        <div className="section-heading">
          <div className="text-lg">近 7 日趋势</div>
        </div>
        <TrendChart
          records={records}
          dailyGoal={dailyGoal}
          dailyLimit={dailyLimit}
          onBarSelect={(date) => {
            const [y, m, d] = date.split("-").map(Number);
            const day = new Date(y, m - 1, d);
            const dayRecs = recordsForDay(records, day);
            if (!dayRecs.length) {
              onDaySelect(date);
              return;
            }
            setDayModal({ date, records: dayRecs });
          }}
        />
      </section>

      <Modal open={!!dayModal} onClose={() => setDayModal(null)} ariaLabel="当日记录">
        {dayModal && (
          <>
            <h2>
              {dayModal.date} ·{" "}
              {sumRecordCalories(dayModal.records)} kcal
            </h2>
            <RecordList
              records={dayModal.records}
              today={false}
              onEdit={onEdit}
              onDelete={onDelete}
            />
            <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
              <button className="btn-ghost" type="button" onClick={() => setDayModal(null)}>
                关闭
              </button>
            </div>
          </>
        )}
      </Modal>
    </main>
  );
}
