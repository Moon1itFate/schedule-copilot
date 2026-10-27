import type { AppState, Course, Task, Term } from '../src/types.js';
import { parseWeeks } from '../src/lib/weeks.js';

const pad = (n: number) => String(n).padStart(2, '0');

export function parseLocal(value: string): Date {
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
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

export function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function weekIndexOf(termStart: string, date: Date): number {
  const start = mondayOf(parseLocal(termStart));
  const days = Math.round((new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() - start.getTime()) / 86400000);
  if (days < 0) return 0;
  return Math.floor(days / 7) + 1;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function fromMinutes(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function normalizeTime(value: unknown, fallback: string): string {
  const s = String(value ?? '').trim();
  const m = s.match(/^(\d{1,2})[:：](\d{2})$/);
  if (!m) return fallback;
  if (Number(m[1]) > 23 || Number(m[2]) > 59) return fallback;
  return `${pad(Number(m[1]))}:${pad(Number(m[2]))}`;
}

export function normalizeDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const s = String(value).trim().replace(/\//g, '-');
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?$/);
  if (!m) return undefined;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  if (year < 1 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59)) return undefined;
  const base = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
  if (m[4] !== undefined) return `${base}T${pad(Number(m[4]))}:${m[5]}`;
  return base;
}

export function periodsToTime(periods: number[], term: Term): { startTime: string; endTime: string } | null {
  const sorted = [...new Set(periods)].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const first = term.periods.find((p) => p.index === sorted[0]);
  const last = term.periods.find((p) => p.index === sorted[sorted.length - 1]);
  if (!first || !last) return null;
  return { startTime: first.start, endTime: last.end };
}

export function timeToPeriods(startTime: string, endTime: string, term: Term): number[] {
  const s = toMinutes(startTime);
  const e = toMinutes(endTime);
  return term.periods.filter((p) => toMinutes(p.start) < e && toMinutes(p.end) > s).map((p) => p.index);
}

export function expandWeeks(spec: string, totalWeeks: number): number[] {
  return parseWeeks(String(spec), totalWeeks);
}

export function summarizeCourse(c: Course, term: Term): string {
  const wd = ['一', '二', '三', '四', '五', '六', '日'][c.weekday - 1] ?? '?';
  const weeks = c.weeks.length > 6 ? `${c.weeks[0]}-${c.weeks[c.weeks.length - 1]}周` : `${c.weeks.join(',')}周`;
  return `${c.title}（周${wd} ${c.startTime}-${c.endTime}${c.location ? ` @${c.location}` : ''}${weeks ? ` ${weeks}` : ''}）`;
}

export function scheduleText(state: AppState, from: Date, to: Date): string {
  const lines: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  while (cursor <= end) {
    const dateStr = fmtDate(cursor);
    const week = weekIndexOf(state.term.startDate, cursor);
    const weekday = ((cursor.getDay() + 6) % 7) + 1;
    const courses = state.courses.filter((c) => c.weekday === weekday && c.weeks.includes(week));
    const tasks = state.tasks.filter((t) => (t.due ?? '').slice(0, 10) === dateStr);
    if (courses.length || tasks.length) {
      lines.push(`${cursor.getMonth() + 1}月${cursor.getDate()}日 ${dayNames[cursor.getDay()]}（第${week}周）`);
      for (const c of courses.sort((a, b) => a.startTime.localeCompare(b.startTime))) {
        lines.push(`  ${c.startTime}-${c.endTime} [课] ${c.title}${c.location ? ` @${c.location}` : ''}`);
      }
      for (const t of tasks.sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))) {
        const time = (t.due ?? '').slice(11, 16) || '全天';
        lines.push(`  ${time} [${t.done ? '已完成' : '截止'}] ${t.title}${t.location ? ` @${t.location}` : ''}（id:${t.id}）`);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return lines.length ? lines.join('\n') : '这段时间没有课程和任务。';
}
