import { useMemo, type KeyboardEvent } from "react";
import type { DayStat, Record } from "../../types";
import { formatDayLabel, getLast7Days, isoDate } from "../../utils/dates";
import { totalForDay } from "../../utils/nutrition";

interface TrendChartProps {
  records: Record[];
  dailyGoal: number;
  dailyLimit: number;
  onBarSelect: (date: string, calories: number) => void;
}

const WIDTH = 420;
const HEIGHT = 120;
const PADDING = 22;
const GAP = 10;
const CHART_HEIGHT = 72;

export function TrendChart({ records, dailyGoal, dailyLimit, onBarSelect }: TrendChartProps) {
  const week: DayStat[] = useMemo(() => {
    return getLast7Days().map((date) => ({
      date,
      isoDate: isoDate(date),
      label: formatDayLabel(date),
      calories: totalForDay(records, date),
      isToday: isSameDate(date, new Date()),
    }));
  }, [records]);

  const maxValue = Math.max(
    dailyLimit,
    ...week.map((d) => d.calories),
    1,
  );

  const goalY = PADDING + CHART_HEIGHT - (dailyGoal / maxValue) * CHART_HEIGHT;
  const limitY = PADDING + CHART_HEIGHT - (dailyLimit / maxValue) * CHART_HEIGHT;
  const barWidth = (WIDTH - PADDING * 2) / 7 - GAP;
  const pointFor = (day: DayStat, index: number) => {
    const slot = (WIDTH - PADDING * 2) / 7;
    const x = PADDING + index * slot + slot / 2;
    const barHeight = Math.max(2, (day.calories / maxValue) * CHART_HEIGHT);
    const y = PADDING + CHART_HEIGHT - barHeight;
    return { x, y, barHeight };
  };
  const linePoints = week
    .map((day, index) => {
      const { x, y } = pointFor(day, index);
      return `${x},${y}`;
    })
    .join(" ");

  const handleKey = (e: KeyboardEvent<SVGGElement>, date: string, calories: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onBarSelect(date, calories);
    }
  };

  return (
    <>
      <div className="text-xs" id="trend-max-label" style={{ textAlign: "right" }}>
        最高刻度 {Math.round(maxValue)} kcal
      </div>
      <div className="panel trend-wrap">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="近 7 日热量趋势图，点击柱状图可查看当日记录"
        >
          <line
            x1={PADDING}
            x2={WIDTH - PADDING}
            y1={PADDING + CHART_HEIGHT}
            y2={PADDING + CHART_HEIGHT}
            stroke="var(--c-border)"
            opacity={0.9}
          />
          <line
            x1={PADDING}
            x2={WIDTH - PADDING}
            y1={goalY}
            y2={goalY}
            stroke="var(--c-amber)"
            strokeDasharray="4 4"
            opacity={0.7}
          />
          <text
            x={WIDTH - PADDING}
            y={Math.max(10, goalY - 5)}
            textAnchor="end"
            fontSize={10}
            fill="var(--c-amber)"
          >
            目标
          </text>
          <line
            x1={PADDING}
            x2={WIDTH - PADDING}
            y1={limitY}
            y2={limitY}
            stroke="var(--c-red)"
            strokeDasharray="2 5"
            opacity={0.72}
          />
          <text
            x={PADDING}
            y={Math.max(10, limitY - 5)}
            textAnchor="start"
            fontSize={10}
            fill="var(--c-red)"
          >
            上限
          </text>
          <polyline
            points={linePoints}
            fill="none"
            stroke="var(--c-green)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {week.map((day, index) => {
            const slot = (WIDTH - PADDING * 2) / 7;
            const x = PADDING + index * slot + GAP / 2;
            const point = pointFor(day, index);
            const color = day.isToday ? "var(--c-green)" : "var(--c-green)";
            const cap =
              day.calories > dailyLimit ? (
                <circle cx={point.x} cy={point.y - 5} r={3} fill="var(--c-red)" />
              ) : null;
            return (
              <g
                key={day.isoDate}
                className="trend-bar"
                data-date={day.isoDate}
                data-calories={day.calories}
                tabIndex={0}
                role="button"
                aria-label={`${day.label} ${day.calories} 千卡，点击查看当日记录`}
                onClick={() => onBarSelect(day.isoDate, day.calories)}
                onKeyDown={(e) => handleKey(e, day.isoDate, day.calories)}
              >
                <rect
                  x={x}
                  y={PADDING}
                  width={barWidth}
                  height={CHART_HEIGHT}
                  fill="transparent"
                />
                <rect
                  x={x}
                  y={point.y}
                  width={barWidth}
                  height={point.barHeight}
                  rx={5}
                  fill={color}
                  opacity={day.isToday ? 0.28 : 0.18}
                />
                {cap}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={3.2}
                  fill="var(--c-bg)"
                  stroke="var(--c-green)"
                  strokeWidth={2}
                />
                <text
                  x={point.x}
                  y={Math.max(10, point.y - 10)}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={day.isToday ? 700 : 500}
                  fill={day.isToday ? "var(--c-green)" : "var(--c-muted)"}
                >
                  {day.calories}
                </text>
                <text
                  x={point.x}
                  y={112}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--c-muted)"
                >
                  {day.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}

function isSameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
