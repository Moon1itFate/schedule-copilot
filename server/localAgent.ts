import type { AppState, Task } from '../src/types.js';
import { newId, saveState } from './store.js';
import { mondayOf, normalizeDate, scheduleText } from './util.js';

/**
 * 本地离线助手：不调用任何模型，用规则把常见中文说法变成日程。
 * 目的是没有 API Key 时也能把「对话 -> 日历」这条路走通。
 */

const CN_NUM: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function cnNumber(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  if (/^\d{1,2}$/.test(text)) return Number(text);
  if (text === '十') return 10;
  if (text.startsWith('十')) {
    const rest = CN_NUM[text[1]];
    return rest === undefined ? 10 : 10 + rest;
  }
  if (text.endsWith('十')) return (CN_NUM[text[0]] ?? 0) * 10;
  if (text.includes('十')) {
    const [a, b] = text.split('十');
    return (CN_NUM[a] ?? 0) * 10 + (CN_NUM[b] ?? 0);
  }
  if (text.length === 1 && CN_NUM[text] !== undefined) return CN_NUM[text];
  return null;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const WEEKDAY_MAP: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

interface DateHit {
  date: Date;
  span: string;
  defaultHour?: number;
}

function findDate(text: string, now: Date): DateHit | null {
  const today = startOfDay(now);
  const currentWeekday = ((today.getDay() + 6) % 7) + 1;

  const evening = text.match(/(今|明|后)晚/);
  if (evening) {
    const delta = evening[1] === '今' ? 0 : evening[1] === '明' ? 1 : 2;
    return { date: addDays(today, delta), span: evening[0], defaultHour: 20 };
  }
  const morning = text.match(/(今|明|后)早/);
  if (morning) {
    const delta = morning[1] === '今' ? 0 : morning[1] === '明' ? 1 : 2;
    return { date: addDays(today, delta), span: morning[0], defaultHour: 8 };
  }

  const relative: { re: RegExp; delta: number }[] = [
    { re: /大后天/, delta: 3 },
    { re: /后天/, delta: 2 },
    { re: /明天|明日/, delta: 1 },
    { re: /今天|今日/, delta: 0 },
  ];
  for (const item of relative) {
    const match = text.match(item.re);
    if (match) return { date: addDays(today, item.delta), span: match[0] };
  }

  const week2 = text.match(/下下周([一二三四五六日天])/);
  if (week2) {
    const target = WEEKDAY_MAP[week2[1]];
    return { date: addDays(today, 14 + (target - currentWeekday)), span: week2[0] };
  }

  const nextWeek = text.match(/下周([一二三四五六日天])/);
  if (nextWeek) {
    const target = WEEKDAY_MAP[nextWeek[1]];
    return { date: addDays(today, 7 + (target - currentWeekday)), span: nextWeek[0] };
  }

  const weekday = text.match(/(?:这周|本周|周|星期)([一二三四五六日天])/);
  if (weekday) {
    const target = WEEKDAY_MAP[weekday[1]];
    const delta = /^(这周|本周)/.test(weekday[0]) ? target - currentWeekday : (target - currentWeekday + 7) % 7;
    return { date: addDays(today, delta), span: weekday[0] };
  }

  const monthDay = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
  if (monthDay) {
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    if (normalizeDate(`${today.getFullYear()}-${month}-${day}`)) {
      let date = new Date(today.getFullYear(), month - 1, day);
      if (date < today) date = new Date(today.getFullYear() + 1, month - 1, day);
      return { date, span: monthDay[0] };
    }
  }

  const nextMonthDay = text.match(/下个月\s*(\d{1,2})\s*[日号]?/);
  if (nextMonthDay) {
    const date = new Date(today.getFullYear(), today.getMonth() + 1, Number(nextMonthDay[1]));
    return { date, span: nextMonthDay[0] };
  }

  return null;
}

interface TimeHit {
  hour: number;
  minute: number;
  span: string;
}

function findTime(text: string, defaultHour?: number): TimeHit | null {
  const colon = text.match(/([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)/);
  if (colon) {
    return { hour: Number(colon[1]), minute: Number(colon[2]), span: colon[0] };
  }

  const plain = text.match(/(凌晨|早晨|早上|上午|中午|下午|傍晚|晚上|晚|早|夜)?\s*([0-9]{1,2}|[零一二两三四五六七八九十]{1,3})\s*[点時时]\s*([0-9]{1,2}|[零一二两三四五六七八九十]{0,3})?\s*(半|分)?/);
  if (!plain) return null;
  const period = plain[1] ?? (defaultHour === 20 ? '晚上' : defaultHour === 8 ? '早上' : '');
  let hour = cnNumber(plain[2]) ?? 0;
  let minute = 0;
  if (plain[4] === '半') minute = 30;
  else if (plain[3]) {
    const parsed = cnNumber(plain[3]);
    if (parsed !== null) minute = parsed;
  }
  if (/^(下午|傍晚|晚上|晚|夜)$/.test(period) && hour < 12) hour += 12;
  else if (/^(晚上|晚|夜)$/.test(period) && hour === 12) hour = 24;
  if (/^(凌晨|早晨|早上|上午|早)$/.test(period) && hour === 12) hour = 0;
  if (period === '中午' && hour < 11) hour += 12;
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null;
  return { hour, minute, span: plain[0] };
}

function inferKind(text: string): Task['kind'] {
  if (/(比赛|竞赛|杯|赛|测评)/.test(text)) return 'contest';
  if (/(考试|考核|测验|期末|期中|四级|六级|模考)/.test(text)) return 'exam';
  return 'task';
}

function cleanTitle(text: string): string {
  const result = text
    .replace(/[，,。；;！!？?]+/g, ' ')
    .replace(/(大后天|后天|明天|明日|今天|今日|明晚|今晚|明早|今早)/g, ' ')
    .replace(/(下下|下)?(?:这|本)?周[一二三四五六日天]/g, ' ')
    .replace(/星期[一二三四五六日天]/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/g, ' ')
    .replace(/(凌晨|早晨|早上|上午|中午|下午|傍晚|晚上|晚|早|夜)?\s*(?:\d{1,2}|[零一二两三四五六七八九十]{1,3})\s*[点時时]\s*(?:\d{1,2}|[零一二两三四五六七八九十]{0,3})?\s*(?:半|分)?/g, ' ')
    .replace(/\d{1,2}\s*[:：]\s*\d{2}/g, ' ')
    .replace(/(记一下|提醒我|帮我|麻烦|记得|安排一下|安排|有个|有一个|要去|要交|需要)/g, ' ')
    .replace(/之前|以前/g, ' ')
    .replace(/前(?=\s*(交|提交|完成|做|写|准备|报名|参加))/g, ' ')
    .replace(/(截止|之前|以前|前)\s*$/g, ' ')
    .replace(/^\s*(交|提交|写|完成|做|参加|准备)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return result.slice(0, 60);
}

function isQuery(text: string): boolean {
  return /(什么|哪些|有啥|多少)/.test(text) && /(今天|今日|明天|明日|后天|这周|本周|下周|最近|接下来|日程|待办|安排)/.test(text);
}

function reply(text: string): string {
  return text;
}

export function handleLocalMessage(input: string, state: AppState): { text: string; changed: boolean } {
  const text = input.trim();
  const now = new Date();

  if (!text) return { text: '说点什么吧，比如「明天下午三点前交高数作业」。', changed: false };

  if (isQuery(text)) {
    let from = startOfDay(now);
    let to = addDays(from, 6);
    if (/这周|本周|下周/.test(text)) {
      from = addDays(mondayOf(now), /下周/.test(text) ? 7 : 0);
      to = addDays(from, 6);
    } else if (/今天|今日|明天|明日|后天/.test(text)) {
      from = addDays(from, /后天/.test(text) ? 2 : /明天|明日/.test(text) ? 1 : 0);
      to = from;
    }
    const queryState = /没做完|未完成|待办/.test(text) ? { ...state, tasks: state.tasks.filter((task) => !task.done) } : state;
    const body = scheduleText(queryState, from, to);
    return { text: `${body}\n\n（本地模式只按关键词查询，复杂问题需要配置模型）`, changed: false };
  }

  if (/(改到|挪到|取消|删掉|删除)/.test(text)) {
    return {
      text: '本地模式还不支持修改/删除。点日历上的条目可以直接改；配好 API Key 后也能用对话改。',
      changed: false,
    };
  }

  const dateHit = findDate(text, now);
  const timeHit = findTime(text, dateHit?.defaultHour);

  if (!dateHit && !timeHit) {
    return {
      text: '本地模式只认常见说法：\n• 明天下午三点前交高数作业\n• 周五前交实验报告\n• 下周三晚上七点蓝桥杯模拟赛\n\n配好 API Key 后可以随便说。',
      changed: false,
    };
  }

  let baseDate: Date;
  let hour: number;
  let minute: number;

  if (dateHit) {
    baseDate = dateHit.date;
    hour = timeHit ? timeHit.hour : dateHit.defaultHour ?? 23;
    minute = timeHit ? timeHit.minute : dateHit.defaultHour !== undefined ? 0 : 59;
  } else {
    const candidate = new Date(now);
    candidate.setHours(timeHit!.hour, timeHit!.minute, 0, 0);
    if (candidate.getTime() < now.getTime()) candidate.setDate(candidate.getDate() + 1);
    baseDate = candidate;
    hour = timeHit!.hour;
    minute = timeHit!.minute;
  }

  const due = new Date(baseDate);
  due.setHours(hour, minute, 0, 0);

  const title = cleanTitle(text) || '新待办';
  const task: Task = {
    id: newId(),
    title,
    kind: inferKind(text),
    due: `${fmtDate(due)}T${pad(due.getHours())}:${pad(due.getMinutes())}`,
    createdAt: new Date().toISOString(),
    done: false,
  };

  state.tasks.push(task);
  saveState(state);

  const when = `${due.getMonth() + 1}月${due.getDate()}日 ${pad(hour)}:${pad(minute)}`;
  return {
    text: reply(`已加入：${task.title} · ${when}${task.kind === 'contest' ? '（比赛）' : task.kind === 'exam' ? '（考试）' : ''}\n在右边日历能看到，点它可以改时间。`),
    changed: true,
  };
}

export function runLocalAgent(
  history: { role: string; content: string }[],
  state: AppState,
  emit: (event: { type: 'text'; value: string } | { type: 'state'; state: AppState } | { type: 'done' }) => void,
) {
  const lastUser = [...history].reverse().find((item) => item.role === 'user')?.content ?? '';
  const result = handleLocalMessage(lastUser, state);
  emit({ type: 'text', value: result.text });
  if (result.changed) emit({ type: 'state', state });
  emit({ type: 'done' });
}
