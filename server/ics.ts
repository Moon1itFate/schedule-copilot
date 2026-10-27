import type { AppState, Course, Task } from '../src/types.js';
import { addDays, mondayOf, parseLocal } from './util.js';

const pad = (n: number) => String(n).padStart(2, '0');

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function fold(line: string): string {
  const bytes = new TextEncoder().encode(line).length;
  if (bytes <= 73) return line;
  const chars = [...line];
  const out: string[] = [];
  let current = '';
  for (const ch of chars) {
    if (new TextEncoder().encode(current + ch).length > 72) {
      out.push(current);
      current = ' ' + ch;
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.join('\r\n');
}

function stamp(date: Date): string {
  const utc = new Date(date.getTime());
  return `${utc.getUTCFullYear()}${pad(utc.getUTCMonth() + 1)}${pad(utc.getUTCDate())}T${pad(utc.getUTCHours())}${pad(utc.getUTCMinutes())}${pad(utc.getUTCSeconds())}Z`;
}

function local(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function courseEvent(state: AppState, course: Course, week: number): string[] {
  const start = mondayOf(parseLocal(state.term.startDate));
  start.setDate(start.getDate() + (week - 1) * 7 + (course.weekday - 1));
  const [sh, sm] = course.startTime.split(':').map(Number);
  const [eh, em] = course.endTime.split(':').map(Number);
  const dtStart = new Date(start);
  dtStart.setHours(sh, sm, 0, 0);
  const dtEnd = new Date(start);
  dtEnd.setHours(eh, em, 0, 0);
  const uid = `${course.id}-w${week}@schedule-copilot`;
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${local(dtStart)}`,
    `DTEND:${local(dtEnd)}`,
    `SUMMARY:${escapeText(`📚 ${course.title}`)}`,
    `X-SCHEDULE-COPILOT:${escapeText(JSON.stringify({ type: 'course', id: course.id, teacher: course.teacher, note: course.note }))}`,
    course.location ? `LOCATION:${escapeText(course.location)}` : '',
    `DESCRIPTION:${escapeText([course.teacher ? `教师：${course.teacher}` : '', `第${week}周`].filter(Boolean).join(' '))}`,
    'END:VEVENT',
  ].filter(Boolean);
}

function taskEvent(task: Task): string[] {
  const lines = ['BEGIN:VEVENT', `UID:${task.id}@schedule-copilot`, `DTSTAMP:${stamp(new Date())}`];
  const prefix = task.kind === 'contest' ? '🏆' : task.kind === 'exam' ? '📝' : '✅';
  if (task.allDay && task.due) {
    const d = parseLocal(task.due);
    const next = addDays(d, 1);
    const fmt = (x: Date) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`;
    lines.push(`DTSTART;VALUE=DATE:${fmt(d)}`, `DTEND;VALUE=DATE:${fmt(next)}`);
  } else if (task.start && task.end) {
    lines.push(`DTSTART:${local(parseLocal(task.start))}`, `DTEND:${local(parseLocal(task.end))}`);
  } else if (task.due) {
    const d = parseLocal(task.due);
    const end = new Date(d.getTime() + 30 * 60000);
    lines.push(`DTSTART:${local(d)}`, `DTEND:${local(end)}`);
  } else {
    return [];
  }
  lines.push(`SUMMARY:${escapeText(`${prefix} ${task.title}`)}`);
  lines.push(`X-SCHEDULE-COPILOT:${escapeText(JSON.stringify({ type: 'task', kind: task.kind, due: task.due, start: task.start, end: task.end, allDay: task.allDay, done: task.done, course: task.course, note: task.note, url: task.url }))}`);
  if (task.location) lines.push(`LOCATION:${escapeText(task.location)}`);
  const description = [task.note, task.url, task.done ? '已完成' : ''].filter(Boolean).join(' ');
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(state: AppState): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Schedule Copilot//日程罗盘//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:日程罗盘',
    'X-WR-TIMEZONE:Asia/Shanghai',
  ];
  for (const course of state.courses) {
    for (const week of course.weeks) {
      if (week < 1 || week > state.term.totalWeeks) continue;
      lines.push(...courseEvent(state, course, week));
    }
  }
  for (const task of state.tasks) {
    lines.push(...taskEvent(task));
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
