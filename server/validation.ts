import type { AppState, Course, PeriodEditing, Task, Term } from '../src/types.js';
import { periodEditingError } from '../src/lib/periods.js';
import { newId } from './store.js';
import { normalizeDate, normalizeTime, timeToPeriods } from './util.js';

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('文字字段必须为字符串');
  return value.trim().slice(0, max) || undefined;
}

export function taskFromInput(input: Record<string, unknown>, existing?: Task): Task {
  const task: Task = existing ? { ...existing } : { id: newId(), title: '', kind: 'task', done: false, createdAt: new Date().toISOString() };
  if (input.title !== undefined) task.title = optionalText(input.title, 80) ?? '';
  if (!task.title) throw new Error('标题不能为空');
  if (input.kind !== undefined) {
    if (!['task', 'contest', 'exam', 'other'].includes(String(input.kind))) throw new Error('日程类型无效');
    task.kind = input.kind as Task['kind'];
  }
  for (const key of ['done', 'allDay'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw new Error('完成和全天标记必须为布尔值');
      task[key] = input[key];
    }
  }
  for (const key of ['due', 'start', 'end'] as const) {
    if (input[key] === undefined) continue;
    const value = input[key];
    const normalized = normalizeDate(value);
    if (value !== null && value !== '' && !normalized) throw new Error('日程日期或时间无效');
    task[key] = key === 'due' && normalized?.length === 10 && !task.allDay ? `${normalized}T23:59` : normalized;
  }
  if (task.start && task.end && task.end <= task.start) throw new Error('结束时间必须晚于开始时间');
  for (const [key, max] of [['location', 60], ['note', 500], ['url', 300], ['course', 60]] as const) {
    if (input[key] !== undefined) task[key] = optionalText(input[key], max);
  }
  return task;
}

export function courseFromInput(input: Record<string, unknown>, term: Term, existing?: Course): Course {
  const course: Course = existing ? { ...existing } : {
    id: newId(), title: '', weekday: 1, startTime: '08:00', endTime: '09:40',
    weeks: Array.from({ length: term.totalWeeks }, (_, i) => i + 1),
  };
  if (input.title !== undefined) course.title = optionalText(input.title, 60) ?? '';
  if (!course.title) throw new Error('课程名不能为空');
  if (input.weekday !== undefined) {
    const weekday = Number(input.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error('星期必须为 1 到 7');
    course.weekday = weekday;
  }
  for (const key of ['startTime', 'endTime'] as const) {
    if (input[key] === undefined) continue;
    const time = normalizeTime(input[key], '');
    if (!time) throw new Error('课程时间无效');
    course[key] = time;
  }
  if (course.endTime <= course.startTime) throw new Error('课程结束时间必须晚于开始时间');
  if (input.weeks !== undefined) {
    if (!Array.isArray(input.weeks)) throw new Error('上课周次必须为数组');
    const weeks = input.weeks.map(Number);
    if (!weeks.length || weeks.some((week) => !Number.isInteger(week) || week < 1 || week > term.totalWeeks)) {
      throw new Error(`上课周次必须在 1 到 ${term.totalWeeks} 之间`);
    }
    course.weeks = [...new Set(weeks)].sort((a, b) => a - b);
  }
  course.periods = timeToPeriods(course.startTime, course.endTime, term);
  for (const [key, max] of [['teacher', 40], ['location', 60], ['note', 500]] as const) {
    if (input[key] !== undefined) course[key] = optionalText(input[key], max);
  }
  return course;
}

export function termFromInput(input: Record<string, unknown>, existing: Term): Term {
  const term = structuredClone(existing);
  if (input.name !== undefined) {
    const name = optionalText(input.name, 40);
    if (!name) throw new Error('学期名称不能为空');
    term.name = name;
  }
  if (input.startDate !== undefined) {
    const date = normalizeDate(input.startDate);
    if (!date || date.length !== 10) throw new Error('开学日期无效');
    term.startDate = date;
  }
  if (input.totalWeeks !== undefined) {
    const weeks = Number(input.totalWeeks);
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 30) throw new Error('学期周数必须为 1 到 30');
    term.totalWeeks = weeks;
  }
  if (input.periods !== undefined) {
    if (!Array.isArray(input.periods) || !input.periods.length) throw new Error('作息表不能为空');
    let previousEnd = '';
    term.periods = input.periods.map((period, index) => {
      const start = normalizeTime(period?.start, '');
      const end = normalizeTime(period?.end, '');
      if (!start || !end || start >= end || start < previousEnd) throw new Error('作息时间必须按顺序排列，结束晚于开始，且不能重叠');
      previousEnd = end;
      return { index: index + 1, start, end };
    });
  }
  if (input.periodEditing !== undefined) {
    const options = input.periodEditing as PeriodEditing | null;
    if (!options || typeof options !== 'object' || typeof options.fixedDuration !== 'boolean' || typeof options.shiftFollowing !== 'boolean') {
      throw new Error('作息编辑选项无效');
    }
    const error = periodEditingError(options);
    if (error) throw new Error(error);
    term.periodEditing = { fixedDuration: options.fixedDuration, duration: options.duration, shiftFollowing: options.shiftFollowing };
  }
  return term;
}

export function updateTerm(state: AppState, input: Record<string, unknown>) {
  const previous = state.term;
  const next = termFromInput(input, previous);
  const courses = input.periods === undefined ? state.courses : state.courses.map((course) => {
    const first = previous.periods.find((period) => period.start === course.startTime);
    const last = previous.periods.find((period) => period.end === course.endTime);
    const updated = { ...course };
    if (first && last && first.index <= last.index) {
      const start = next.periods.find((period) => period.index === first.index);
      const end = next.periods.find((period) => period.index === last.index);
      if (!start || !end) throw new Error(`课程「${course.title}」仍使用第 ${!start ? first.index : last.index} 节，请先调整该课程，再删除对应节次。`);
      updated.startTime = start.start;
      updated.endTime = end.end;
    }
    updated.periods = timeToPeriods(updated.startTime, updated.endTime, next);
    return updated;
  });
  state.term = next;
  state.courses = courses;
}
