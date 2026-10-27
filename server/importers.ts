import ical from 'node-ical';
import type { AppState, Course, ImportResult, Task } from '../src/types.js';
import type { Settings } from './store.js';
import { taskFromInput } from './validation.js';
import { extractTables, htmlToText, matrixToText, toMatrix } from './html.js';
import {
  addDays,
  expandWeeks,
  fmtDate,
  mondayOf,
  normalizeDate,
  normalizeTime,
  parseLocal,
  timeToPeriods,
  toMinutes,
  weekIndexOf,
} from './util.js';

export interface ImportInput {
  mode: 'text' | 'url' | 'ics';
  text?: string;
  url?: string;
  cookie?: string;
  termStart?: string;
  settings: Settings;
  state: AppState;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const WEEK_CELL_RE = /(\d{1,2}\s*[-~－—]\s*\d{1,2}\s*周|\d{1,2}\s*周|[单双]\s*周)/;

function makeCourse(
  input: Partial<Course> & { title: string; weekday: number },
  state: AppState,
  index: number,
): Course {
  const startTime = normalizeTime(input.startTime, '08:00');
  const endTime = normalizeTime(input.endTime, '09:40');
  const weeks = (input.weeks ?? [])
    .map(Number)
    .filter((w) => Number.isFinite(w) && w >= 1 && w <= 30)
    .filter((w, i, arr) => arr.indexOf(w) === i)
    .sort((a, b) => a - b);
  const periods = timeToPeriods(startTime, endTime, state.term);
  return {
    id: `imp-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    title: input.title.trim().slice(0, 60),
    weekday: Math.min(7, Math.max(1, Math.round(input.weekday))),
    startTime,
    endTime,
    weeks: weeks.length ? weeks : Array.from({ length: state.term.totalWeeks }, (_, i) => i + 1),
    teacher: input.teacher?.trim() || undefined,
    location: input.location?.trim() || undefined,
    note: input.note?.trim() || undefined,
    periods: periods.length ? periods : undefined,
  };
}

function finalize(courses: Course[], state: AppState, notes: string[]): ImportResult {
  const seen = new Set<string>();
  const unique: Course[] = [];
  for (const course of courses) {
    if (!course.title) continue;
    const key = `${course.title}|${course.weekday}|${course.startTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(course);
    if (unique.length >= 80) break;
  }
  if (!unique.length) notes.push('没有识别出课程，可以试试减少无关文字，或配置模型后再解析。');
  else notes.push(`识别出 ${unique.length} 门课程。`);
  return { courses: unique, notes };
}

function rowsToCourses(matrix: string[][], state: AppState): Course[] {
  const dayIndex = (text: string): number | null => {
    const compact = text.replace(/\s/g, '');
    const match = compact.match(/(?:星期|周)([一二三四五六日天])/);
    if (!match) return null;
    const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
    return map[match[1]] ?? null;
  };

  let headerRow = -1;
  let colDays: Record<number, number> = {};
  for (let r = 0; r < Math.min(matrix.length, 6); r++) {
    const mapping: Record<number, number> = {};
    matrix[r].forEach((cell, c) => {
      const day = dayIndex(cell);
      if (day) mapping[c] = day;
    });
    if (Object.keys(mapping).length >= 3) {
      headerRow = r;
      colDays = mapping;
      break;
    }
  }
  if (headerRow < 0) return [];

  const courses: Course[] = [];
  let counter = 0;
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r];
    const label = `${row[0] ?? ''} ${row[1] ?? ''}`;
    const periodMatch = label.match(/(\d{1,2})\s*(?:[-~－—]\s*(\d{1,2}))?\s*节/);
    let periods: number[] = [];
    if (periodMatch) {
      const from = Number(periodMatch[1]);
      const to = Number(periodMatch[2] ?? periodMatch[1]);
      for (let p = from; p <= to; p++) periods.push(p);
    }
    if (!periods.length) {
      const nums = label.match(/\d{1,2}/g);
      if (nums?.length) periods = [Number(nums[0])];
    }
    if (!periods.length) continue;
    const startPeriod = state.term.periods.find((p) => p.index === Math.min(...periods));
    const endPeriod = state.term.periods.find((p) => p.index === Math.max(...periods));
    if (!startPeriod || !endPeriod) continue;

    for (const [colText, weekday] of Object.entries(colDays)) {
      const cell = row[Number(colText)];
      if (!cell || !cell.trim()) continue;
      const lines = cell
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.length) continue;

      let weeks: number[] = [];
      let location: string | undefined;
      let title = '';
      let teacher: string | undefined;

      for (const line of lines) {
        if (!weeks.length && WEEK_CELL_RE.test(line)) {
          weeks = expandWeeks(line, state.term.totalWeeks);
          continue;
        }
        if (!location && /(楼|室|馆|场|机房|实验|中心|[A-Za-z]\d{3,4}|\d{3,4})/.test(line) && line.length <= 24) {
          location = line;
          continue;
        }
        if (!title) {
          title = line;
          continue;
        }
        if (!teacher && line.length <= 16) teacher = line;
      }
      if (!title) continue;
      courses.push(
        makeCourse(
          {
            title,
            weekday,
            startTime: startPeriod.start,
            endTime: endPeriod.end,
            weeks: weeks.length ? weeks : Array.from({ length: state.term.totalWeeks }, (_, i) => i + 1),
            teacher,
            location,
          },
          state,
          counter++,
        ),
      );
    }
  }
  return courses;
}

function textLinesToCourses(text: string, state: AppState): Course[] {
  const courses: Course[] = [];
  let counter = 0;
  const dayMap: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length > 120) continue;
    const dayMatch = line.replace(/\s/g, '').match(/(?:星期|周)([一二三四五六日天])/);
    const periodMatch = line.match(/第?\s*(\d{1,2})\s*(?:[-~－—,，]\s*(\d{1,2}))?\s*节/);
    if (!dayMatch || !periodMatch) continue;
    const weekday = dayMap[dayMatch[1]];
    const from = Number(periodMatch[1]);
    const to = Number(periodMatch[2] ?? periodMatch[1]);
    const startPeriod = state.term.periods.find((p) => p.index === from);
    const endPeriod = state.term.periods.find((p) => p.index === to);
    if (!startPeriod || !endPeriod) continue;
    const weekMatch = line.match(/(?:\d{1,2}(?:\s*[-~－—]\s*\d{1,2})?\s*(?:周\s*[（(]?[单双][）)]?|[单双]\s*周?|周)?)(?:\s*[,，]\s*\d{1,2}(?:\s*[-~－—]\s*\d{1,2})?\s*(?:周\s*[（(]?[单双][）)]?|[单双]\s*周?|周)?)*(?=\s|$)/g)?.find((part) => /周|单|双/.test(part));
    const weeks = weekMatch ? expandWeeks(weekMatch, state.term.totalWeeks) : [];
    const title = line
      .replace(weekMatch ?? /$^/, '')
      .replace(/(?:星期|周)[一二三四五六日天]/g, '')
      .replace(/第?\s*\d{1,2}\s*(?:[-~－—,，]\s*\d{1,2})?\s*节/g, '')
      .replace(/[|,，\t]+/g, ' ')
      .trim();
    if (!title) continue;
    const locationMatch = title.match(/\s+([^\s]*(?:楼|室|馆|场|教|机房|实验|中心)\S*|[A-Za-z]?\d{3,4})$/);
    const location = locationMatch ? locationMatch[1] : undefined;
    const cleanTitle = locationMatch ? title.slice(0, locationMatch.index).trim() : title;
    if (!cleanTitle) continue;
    courses.push(
      makeCourse(
        {
          title: cleanTitle.slice(0, 60),
          weekday,
          startTime: startPeriod.start,
          endTime: endPeriod.end,
          weeks: weeks.length ? weeks : Array.from({ length: state.term.totalWeeks }, (_, i) => i + 1),
          location,
        },
        state,
        counter++,
      ),
    );
  }
  return courses;
}

async function callJson(settings: Settings, system: string, user: string): Promise<any> {
  const base = settings.baseUrl.trim().replace(/\/+$/, '');
  const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  const run = async (extra: string) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user + extra },
        ],
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`模型返回 ${response.status}：${body.slice(0, 200)}`);
    }
    const json: any = await response.json();
    return String(json?.choices?.[0]?.message?.content ?? '');
  };

  const parse = (raw: string) => {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : raw;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('模型没有输出 JSON');
    return JSON.parse(candidate.slice(start, end + 1));
  };

  const first = await run('');
  try {
    return parse(first);
  } catch {
    const second = await run('\n\n注意：上一次输出不是合法 JSON。只输出 JSON，不要解释、不要代码块。');
    return parse(second);
  }
}

function llmSystemPrompt(state: AppState, totalWeeks: number): string {
  const periods = state.term.periods.map((p) => `第${p.index}节 ${p.start}-${p.end}`).join('；');
  return `你是一个课表结构化助手。把用户提供的课表内容（HTML 表格文本、复制的文字或 JSON）抽取成课程列表。

作息时间：${periods}

只输出 JSON，格式：
{"termStart":"YYYY-MM-DD 或 null","courses":[{"title":"课程名","teacher":"教师","location":"地点","weekday":1,"startTime":"08:00","endTime":"09:40","weeks":[1,2,3]}]}

规则：
1. weekday：周一=1，周二=2，…，周日=7。
2. startTime/endTime 必须是 HH:mm，按上课节次和上面的作息换算；跨两节就取第一节开始到第二节结束。
3. weeks 必须是显式数组，把“1-16周”“单周”“双周”“1-8,10-16周”展开成数字；没写周次的默认 1-${totalWeeks}。
4. 去掉“未安排”“体育课”等占位内容；不要合并不同时间的同名课程。
5. 不要编造课程，不要输出多余字段，不要输出解释。`;
}

function mapLlmCourses(json: any, state: AppState): Course[] {
  const list = Array.isArray(json?.courses) ? json.courses : [];
  const courses: Course[] = [];
  list.forEach((item: any, index: number) => {
    const title = String(item?.title ?? '').trim();
    const weekday = Number(item?.weekday);
    if (!title || !Number.isFinite(weekday) || weekday < 1 || weekday > 7) return;
    courses.push(
      makeCourse(
        {
          title,
          weekday,
          startTime: item.startTime,
          endTime: item.endTime,
          weeks: Array.isArray(item.weeks) ? item.weeks.map(Number) : [],
          teacher: item.teacher ? String(item.teacher) : undefined,
          location: item.location ? String(item.location) : undefined,
        },
        state,
        index,
      ),
    );
  });
  return courses;
}

function zfJsonCourses(json: any, state: AppState): Course[] {
  const list = json?.kbList ?? json?.data?.kbList ?? json?.xkxx ?? null;
  if (!Array.isArray(list)) return [];
  const courses: Course[] = [];
  list.forEach((item: any, index: number) => {
    const title = String(item?.kcmc ?? item?.courseName ?? '').trim();
    const weekdayRaw = Number(item?.xqj ?? item?.weekday);
    if (!title || !Number.isFinite(weekdayRaw)) return;
    const weekday = weekdayRaw >= 1 && weekdayRaw <= 7 ? weekdayRaw : weekdayRaw + 1;
    const jc = String(item?.jc ?? item?.period ?? '1-2');
    const nums = jc.match(/\d{1,2}/g) ?? ['1', '2'];
    const from = Number(nums[0]);
    const to = Number(nums[nums.length - 1]);
    const startPeriod = state.term.periods.find((p) => p.index === from) ?? state.term.periods[0];
    const endPeriod = state.term.periods.find((p) => p.index === to) ?? state.term.periods[1];
    const weeks = expandWeeks(String(item?.zcd ?? item?.weeks ?? ''), state.term.totalWeeks);
    courses.push(
      makeCourse(
        {
          title,
          weekday,
          startTime: startPeriod.start,
          endTime: endPeriod.end,
          weeks,
          teacher: item?.xm ? String(item.xm) : undefined,
          location: item?.cdmc ? String(item.cdmc) : undefined,
        },
        state,
        index,
      ),
    );
  });
  return courses;
}

function occurrencesFor(ev: any, startLimit: Date, endLimit: Date): Date[] {
  const result: Date[] = [];
  const rrule = ev.rrule;
  if (!rrule) return [new Date(ev.start)];
  if (typeof rrule.between === 'function') {
    try {
      return rrule.between(startLimit, endLimit, true).map((d: Date) => new Date(d));
    } catch {
      /* fall through */
    }
  }
  const interval = Math.max(1, Number(rrule.options?.interval ?? 1));
  const until = rrule.options?.until ? new Date(rrule.options.until) : null;
  const count = rrule.options?.count ? Number(rrule.options.count) : Infinity;
  let cursor = new Date(ev.start);
  let seen = 0;
  while (cursor <= endLimit && seen < 300) {
    if (cursor >= startLimit) {
      if (until && cursor > until) break;
      result.push(new Date(cursor));
      seen++;
      if (seen >= count) break;
    }
    cursor = addDays(cursor, 7 * interval);
  }
  return result;
}

function parseIcs(text: string, state: AppState): ImportResult {
  const notes: string[] = [];
  const parsed: any = (ical as any).sync ? (ical as any).sync.parseICS(text) : (ical as any).parseICS(text);
  const startLimit = mondayOf(parseLocal(state.term.startDate));
  const endLimit = addDays(startLimit, state.term.totalWeeks * 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  const courses: Course[] = [];
  const tasks: Task[] = [];
  const singles: { title: string; start: Date; end: Date; location?: string; description?: string; allDay: boolean; metadata?: Record<string, any> }[] = [];
  let index = 0;

  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
    const title =
      String(ev.summary ?? '未命名')
        .replace(/^[\p{Extended_Pictographic}\uFE0F\s]+/u, '')
        .trim() || '未命名';
    const startDate = new Date(ev.start);
    const endDate = ev.end ? new Date(ev.end) : new Date(startDate.getTime() + 45 * 60000);
    let metadata: Record<string, any> | undefined;
    try {
      const value = JSON.parse(String(ev['SCHEDULE-COPILOT'] ?? 'null'));
      if (value && typeof value === 'object' && ['task', 'course'].includes(value.type)) metadata = value;
    } catch { /* Other calendars need no Schedule Copilot metadata. */ }

    if (ev.rrule) {
      const occ = occurrencesFor(ev, startLimit, endLimit);
      const weeks = [...new Set(occ.map((d) => weekIndexOf(state.term.startDate, d)))].filter(
        (w) => w >= 1 && w <= state.term.totalWeeks,
      );
      if (!weeks.length) continue;
      courses.push(
        makeCourse(
          {
            title,
            weekday: ((startDate.getDay() + 6) % 7) + 1,
            startTime: `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`,
            endTime: `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`,
            weeks,
            location: ev.location ? String(ev.location) : undefined,
            teacher: ev.description ? String(ev.description).slice(0, 40) : undefined,
          },
          state,
          index++,
        ),
      );
      continue;
    }

    if (metadata?.type === 'course' && (startDate < startLimit || startDate >= endLimit)) continue;
    singles.push({
      title,
      start: startDate,
      end: endDate,
      location: ev.location ? String(ev.location) : undefined,
      description: ev.description ? String(ev.description) : undefined,
      allDay: ev.datetype === 'date',
      metadata,
    });
  }

  // 很多教务系统/课程表导出的 ICS 是「每周一条」而不是 RRULE，这里按 标题+星期+时间 归并成课程
  const groups = new Map<string, typeof singles>();
  for (const item of singles) {
    const key = item.metadata?.type === 'task' || item.allDay ? `task-${groups.size}` : `${item.metadata?.id ?? item.title}|${((item.start.getDay() + 6) % 7) + 1}|${pad(item.start.getHours())}:${pad(item.start.getMinutes())}|${pad(item.end.getHours())}:${pad(item.end.getMinutes())}|${item.location ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }

  for (const list of groups.values()) {
    const first = list[0];
    if (first.metadata?.type === 'course' || list.length >= 2) {
      const weeks = [...new Set(list.map((item) => weekIndexOf(state.term.startDate, item.start)))].filter(
        (w) => w >= 1 && w <= state.term.totalWeeks,
      );
      if (first.metadata?.type === 'course' || weeks.length >= 2) {
        courses.push(
          makeCourse(
            {
              title: first.title,
              weekday: ((first.start.getDay() + 6) % 7) + 1,
              startTime: `${pad(first.start.getHours())}:${pad(first.start.getMinutes())}`,
              endTime: `${pad(first.end.getHours())}:${pad(first.end.getMinutes())}`,
              weeks,
              location: first.location,
              teacher: first.metadata?.teacher,
              note: first.metadata?.note,
            },
            state,
            index++,
          ),
        );
        continue;
      }
    }
    for (const item of list) {
      const fmt = (date: Date) => `${fmtDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
      const meta = item.metadata?.type === 'task' ? item.metadata : undefined;
      tasks.push(taskFromInput({
        title: item.title,
        kind: meta?.kind ?? (/考|exam/i.test(item.title) ? 'exam' : 'other'),
        due: meta?.due ?? (item.allDay ? fmtDate(item.start) : fmt(item.start)),
        start: meta ? meta.start : item.allDay ? undefined : fmt(item.start),
        end: meta ? meta.end : item.allDay ? undefined : fmt(item.end),
        allDay: meta?.allDay ?? item.allDay,
        done: meta?.done ?? false,
        location: item.location,
        note: meta?.note ?? item.description?.slice(0, 500),
        url: meta?.url,
        course: meta?.course,
      }));
    }
  }

  notes.push(`从 ICS 解析出 ${courses.length} 门课程、${tasks.length} 个单次日程。`);
  return { courses: finalize(courses, state, []).courses, notes, tasks };
}

export async function importCourses(input: ImportInput): Promise<ImportResult & { tasks?: Task[] }> {
  const { settings } = input;
  let state = input.state;
  if (input.termStart !== undefined) {
    const start = normalizeDate(input.termStart);
    if (!start || start.length !== 10) throw new Error('开学日期无效');
    state = { ...state, term: { ...state.term, startDate: start } };
  }
  const notes: string[] = [];
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(settings.baseUrl);
  const hasLlm = !settings.localMode && Boolean(settings.baseUrl && (settings.apiKey || isLocal));

  if (input.mode === 'ics') {
    const text = input.text ?? '';
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('不是有效的 ICS 文件（缺少 BEGIN:VCALENDAR）。');
    return parseIcs(text, state);
  }

  let source = (input.text ?? '').trim();
  let fallback: Course[] = [];

  if (input.mode === 'url') {
    const url = (input.url ?? '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('请填写以 http:// 或 https:// 开头的教务系统地址。');
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          ...(input.cookie ? { Cookie: input.cookie } : {}),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      throw new Error(`抓取失败：${error instanceof Error ? error.message : String(error)}。检查地址是否正确、是否需要校园网/VPN。`);
    }
    if (!response.ok) throw new Error(`教务系统返回 ${response.status}，Cookie 可能过期，重新登录后再复制。`);
    const contentType = response.headers.get('content-type') ?? '';
    const raw = await response.text();
    if (raw.length > 3_000_000) throw new Error('页面太大，建议直接复制课表区域再粘贴。');

    if (contentType.includes('json') || raw.trim().startsWith('{')) {
      try {
        const json = JSON.parse(raw);
        const courses = zfJsonCourses(json, state);
        if (courses.length) return finalize(courses, state, notes);
      } catch {
        /* not json */
      }
      source = raw.slice(0, 40_000);
    } else {
      const tables = extractTables(raw);
      const best = tables
        .map((rows) => toMatrix(rows))
        .sort((a, b) => b.length * (b[0]?.length ?? 0) - a.length * (a[0]?.length ?? 0))[0];
      if (best) {
        const heuristic = rowsToCourses(best, state);
        fallback = heuristic;
        if (heuristic.length >= 2 && !hasLlm) return finalize(heuristic, state, notes);
        source = matrixToText(best);
        if (hasLlm && heuristic.length) notes.push('已用表格规则做了一版解析，同时交给模型校正。');
        if (!hasLlm && heuristic.length) return finalize(heuristic, state, notes);
      } else {
        source = htmlToText(raw).slice(0, 40_000);
      }
    }
  }

  if (!source) throw new Error('没有可解析的内容。');

  if (hasLlm) {
    try {
      const json = await callJson(settings, llmSystemPrompt(state, state.term.totalWeeks), source.slice(0, 30_000));
      const courses = mapLlmCourses(json, state);
      const termStart =
        typeof json?.termStart === 'string' && /^\d{4}-\d{2}-\d{2}/.test(json.termStart) ? json.termStart.slice(0, 10) : undefined;
      const result = finalize(courses, state, notes);
      return { ...result, termStart };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notes.push(`模型解析失败（${message.slice(0, 160)}），已回退到规则解析。`);
      if (fallback.length) return finalize(fallback, state, notes);
    }
  }

  const heuristics = fallback.length ? fallback : textLinesToCourses(source, state);
  if (!heuristics.length) {
    notes.push('没有配置模型，规则解析也没认出课程。请在设置里填 API Key，或把课表按“课程名 周一 1-2节 1-16周”这样的格式粘贴。');
  }
  return finalize(heuristics, state, notes);
}

/** 供导出使用：展开某门课在指定周的上课日期 */
export function courseDate(state: AppState, course: Course, week: number): Date {
  const start = mondayOf(parseLocal(state.term.startDate));
  const day = addDays(start, (week - 1) * 7 + (course.weekday - 1));
  const [h, m] = course.startTime.split(':').map(Number);
  day.setHours(h, m, 0, 0);
  return day;
}

export function minutesOf(hhmm: string): number {
  return toMinutes(hhmm);
}
