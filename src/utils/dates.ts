export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatDayLabel(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function isoDate(date: Date): string {
  return formatDate(date);
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(timestamp: number): boolean {
  return isSameDay(new Date(timestamp), new Date());
}

export function getLast7Days(now: Date = new Date()): Date[] {
  const days: Date[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(startOfDay(d));
  }
  return days;
}

export function getMealType(timestamp: number): string {
  const hour = new Date(timestamp).getHours();
  if (hour >= 5 && hour < 10) return "早餐";
  if (hour >= 10 && hour < 14) return "午餐";
  if (hour >= 14 && hour < 17) return "下午茶";
  if (hour >= 17 && hour < 21) return "晚餐";
  return "加餐";
}

export function formatRecordDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function formatRecordTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRecordDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN");
}
