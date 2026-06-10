import type { Record } from "../types";
import { formatDate, formatTime } from "./dates";

const HEADERS = [
  "日期",
  "时间",
  "餐次",
  "食物",
  "克重(g)",
  "热量(kcal)",
  "来源",
  "演示数据",
];

function escapeCSVCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCSV(records: Record[]): string {
  const rows: unknown[][] = [HEADERS];
  for (const record of records) {
    const d = new Date(record.timestamp);
    const dateStr = formatDate(d);
    const timeStr = formatTime(d);
    for (const food of record.foods) {
      rows.push([
        dateStr,
        timeStr,
        record.mealType || "",
        food.name,
        food.weight_g,
        food.total_calories,
        food.cal_source || "ai_estimate",
        record.isDemo ? "是" : "否",
      ]);
    }
  }
  return "\ufeff" + rows.map((row) => row.map(escapeCSVCell).join(",")).join("\n");
}

export function downloadCSV(records: Record[]): void {
  if (!records.length) return;
  const csv = buildCSV(records);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const filename = `caloriemaster_${new Date().toISOString().slice(0, 10)}.csv`;
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
