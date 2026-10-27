export const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
export const WEEKDAY_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const pad = (n: number) => String(n).padStart(2, '0');

/** 解析 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm 为本地时间 Date */
export function parseLocal(value: string): Date {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return new Date(value);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), 0, 0);
}

export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDateTime(d: Date): string {
  return `${fmtDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function mondayOf(d: Date): Date {
  const x = startOfDay(d);
  const shift = (x.getDay() + 6) % 7;
  return addDays(x, -shift);
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
}

/** 1-based 教学周；早于开学返回 0 */
export function weekIndexOf(termStart: string, date: Date): number {
  const start = mondayOf(parseLocal(termStart));
  const days = diffDays(date, start);
  if (days < 0) return 0;
  return Math.floor(days / 7) + 1;
}

export function weekdayOf(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function fromMinutes(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function fmtTime(hhmm: string): string {
  return hhmm;
}

/** 9月14日 */
export function fmtMonthDay(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** 相对今天的自然语言：今天 / 明天 / 10月28日 */
export function relativeDayLabel(d: Date, now = new Date()): string {
  const delta = diffDays(d, now);
  if (delta === 0) return '今天';
  if (delta === 1) return '明天';
  if (delta === 2) return '后天';
  if (delta === -1) return '昨天';
  if (delta > 0 && delta < 7) return WEEKDAY_FULL[weekdayOf(d) - 1];
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtDue(due?: string, now = new Date()): string {
  if (!due) return '无截止';
  const d = parseLocal(due);
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const delta = diffDays(d, now);
  if (delta === 0) return `今天 ${hhmm}`;
  if (delta === 1) return `明天 ${hhmm}`;
  if (delta === -1) return `昨天 ${hhmm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

export function isOverdue(due?: string, now = new Date()): boolean {
  if (!due) return false;
  return parseLocal(due).getTime() < now.getTime();
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
