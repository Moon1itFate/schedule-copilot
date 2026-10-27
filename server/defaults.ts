import type { AppState, Course, Period, Term } from '../src/types.js';
import type { Settings } from './store.js';
export const DEFAULT_PERIODS: Period[] = [
  { index: 1, start: '08:00', end: '08:45' },
  { index: 2, start: '08:55', end: '09:40' },
  { index: 3, start: '10:00', end: '10:45' },
  { index: 4, start: '10:55', end: '11:40' },
  { index: 5, start: '14:00', end: '14:45' },
  { index: 6, start: '14:55', end: '15:40' },
  { index: 7, start: '16:00', end: '16:45' },
  { index: 8, start: '16:55', end: '17:40' },
  { index: 9, start: '19:00', end: '19:45' },
  { index: 10, start: '19:55', end: '20:40' },
];

export const DEFAULT_SETTINGS: Settings = {
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: '',
  temperature: 0.3,
  localMode: false,
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mondayOf(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function defaultTerm(): Term {
  const start = addDays(mondayOf(new Date()), -6 * 7);
  return {
    name: `${start.getFullYear()} 秋季学期`,
    startDate: fmtDate(start),
    totalWeeks: 18,
    periods: DEFAULT_PERIODS,
  };
}

function seed(state: AppState): AppState {
  const now = new Date();
  const term = state.term;
  const course = (title: string, weekday: number, startTime: string, endTime: string, periods: number[], location: string, teacher: string): Course => ({
    id: globalThis.crypto.randomUUID(),
    title,
    teacher,
    location,
    weekday,
    startTime,
    endTime,
    periods,
    weeks: Array.from({ length: Math.min(16, term.totalWeeks) }, (_, i) => i + 1),
  });
  state.courses = [
    course('高等数学 A', 1, '08:00', '09:40', [1, 2], '教三 201', '王老师'),
    course('大学英语', 2, '10:00', '11:40', [3, 4], '外语楼 305', '李老师'),
    course('数据结构', 4, '14:00', '15:40', [5, 6], '计算机楼 402', '陈老师'),
    course('篮球（体育）', 5, '16:00', '17:40', [7, 8], '东区体育馆', '赵老师'),
  ];
  const due = (daysAhead: number, hh: number, mm: number) => {
    const d = addDays(now, daysAhead);
    d.setHours(hh, mm, 0, 0);
    return `${fmtDate(d)}T${pad(hh)}:${pad(mm)}`;
  };
  state.tasks = [
    {
      id: globalThis.crypto.randomUUID(),
      title: '高数作业：第 3 章习题',
      kind: 'task',
      due: due(1, 22, 0),
      course: '高等数学 A',
      note: '习题 3.1 / 3.3 单数题',
      createdAt: now.toISOString(),
    },
    {
      id: globalThis.crypto.randomUUID(),
      title: '蓝桥杯校内选拔报名',
      kind: 'contest',
      due: due(5, 18, 0),
      location: '线上',
      createdAt: now.toISOString(),
    },
    {
      id: globalThis.crypto.randomUUID(),
      title: '英语四级模拟考',
      kind: 'exam',
      due: due(2, 9, 0),
      end: due(2, 11, 20),
      location: '教三 201',
      createdAt: now.toISOString(),
    },
  ];
  return state;
}

export function defaultState(demo = false): AppState {
  const blank: AppState = { term: defaultTerm(), courses: [], tasks: [] };
  return demo ? seed(blank) : blank;
}
