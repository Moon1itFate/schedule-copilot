import type { Period, PeriodEditing } from '../types';
import { fromMinutes, toMinutes } from './date';

export function periodError(periods: Period[]): string | null {
  if (!periods.length) return '至少保留一节课。';
  let previousEnd = '';
  for (let i = 0; i < periods.length; i++) {
    const { start, end } = periods[i];
    const valid = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    if (!valid(start) || !valid(end)) return `请填写第 ${i + 1} 节的完整时间。`;
    if (end <= start) return `第 ${i + 1} 节的结束时间必须晚于开始时间。`;
    if (start < previousEnd) return `第 ${i + 1} 节与上一节时间重叠，请调整。`;
    previousEnd = end;
  }
  return null;
}

export function nextPeriod(periods: Period[], duration = 45): Period | null {
  const last = periods.at(-1);
  const start = last ? toMinutes(last.end) + 10 : 8 * 60;
  if (start + duration > 1439) return null;
  return { index: periods.length + 1, start: fromMinutes(start), end: fromMinutes(start + duration) };
}

export function defaultPeriodEditing(periods: Period[], saved?: PeriodEditing): PeriodEditing {
  const first = periods[0];
  return saved ? { ...saved } : {
    fixedDuration: false,
    duration: first ? Math.max(1, toMinutes(first.end) - toMinutes(first.start)) : 45,
    shiftFollowing: false,
  };
}

export function periodEditingError(options: PeriodEditing): string | null {
  if (!Number.isInteger(options.duration) || options.duration < 1 || options.duration > 240) return '每节课时长请填写 1～240 分钟的整数。';
  return null;
}

function checkedTime(minute: number, index: number): string {
  if (minute < 0 || minute > 1439) throw new Error(`调整后第 ${index + 1} 节超出当天范围，请提前开始时间或缩短时长。`);
  return fromMinutes(minute);
}

/** Shift by the edited end-time delta, preserving every existing break and lunch gap. */
export function editPeriod(periods: Period[], index: number, key: 'start' | 'end', value: string, options: PeriodEditing): Period[] {
  const result = periods.map((period) => ({ ...period }));
  const old = periods[index];
  if (!old) return result;
  result[index][key] = value;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return result;
  if ((options.fixedDuration || options.shiftFollowing) && periodError(periods)) throw new Error('请先修正当前作息，再使用自动调整。');
  if (options.fixedDuration) {
    const error = periodEditingError(options);
    if (error) throw new Error(error);
    if (key === 'start') result[index].end = checkedTime(toMinutes(value) + options.duration, index);
    else result[index].start = checkedTime(toMinutes(value) - options.duration, index);
  }
  // A changed start without a duration lock moves this whole period as a unit in linked mode.
  else if (options.shiftFollowing && key === 'start' && /^([01]\d|2[0-3]):[0-5]\d$/.test(old.start)) {
    result[index].end = checkedTime(toMinutes(old.end) + toMinutes(value) - toMinutes(old.start), index);
  }
  if (options.shiftFollowing) {
    const delta = toMinutes(result[index].end) - toMinutes(old.end);
    for (let i = index + 1; i < result.length; i++) {
      result[i].start = checkedTime(toMinutes(periods[i].start) + delta, i);
      result[i].end = checkedTime(toMinutes(periods[i].end) + delta, i);
    }
  }
  return result;
}

/** Apply one duration to all periods; optionally retain the original gaps as lengths change. */
export function setPeriodDuration(periods: Period[], duration: number, shiftFollowing: boolean): Period[] {
  const error = periodError(periods);
  if (error) throw new Error(`请先修正当前作息：${error}`);
  if (periodEditingError({ fixedDuration: true, duration, shiftFollowing })) throw new Error('每节课时长请填写 1～240 分钟的整数。');
  const result: Period[] = [];
  for (let i = 0; i < periods.length; i++) {
    const start = i > 0 && shiftFollowing
      ? toMinutes(result[i - 1].end) + toMinutes(periods[i].start) - toMinutes(periods[i - 1].end)
      : toMinutes(periods[i].start);
    result.push({ index: i + 1, start: checkedTime(start, i), end: checkedTime(start + duration, i) });
  }
  return result;
}

export interface PeriodRow {
  start: number;
  end: number;
  top: number;
  height: number;
  period?: Period;
}

/** Equal-sized teaching periods, with short breaks instead of hours of empty grid. */
export function periodTimeline(periods: Period[], extra: { start: number; end: number }[] = []) {
  const rows: PeriodRow[] = [];
  const first = periods[0] ? toMinutes(periods[0].start) : 480;
  const last = periods.at(-1) ? toMinutes(periods.at(-1)!.end) : 1260;
  const start = Math.max(0, Math.min(first, ...extra.map((range) => range.start)));
  const end = Math.min(1440, Math.max(last, ...extra.map((range) => range.end)));
  let cursor = start;
  let height = 0;
  const append = (from: number, to: number, period?: Period) => {
    if (to <= from) return;
    const rowHeight = period ? 68 : to - from >= 30 ? 28 : 12;
    rows.push({ start: from, end: to, top: height, height: rowHeight, period });
    height += rowHeight;
  };
  for (const period of periods) {
    const from = toMinutes(period.start), to = toMinutes(period.end);
    append(cursor, from);
    append(from, to, period);
    cursor = to;
  }
  append(cursor, end);
  const position = (minute: number) => {
    if (minute <= start) return 0;
    if (minute >= end) return height;
    const row = rows.find((item) => minute >= item.start && minute <= item.end);
    return row ? row.top + (minute - row.start) / (row.end - row.start) * row.height : 0;
  };
  return { rows, start, end, height, position };
}

export function shortTime(time: string): string {
  return time.replace(/^0/, '');
}
