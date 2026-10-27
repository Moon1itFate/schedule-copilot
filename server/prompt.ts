import type { AppState } from '../src/types.js';
import { summarizeCourse, weekIndexOf, fmtDate } from './util.js';

const KIND_ENUM = ['task', 'contest', 'exam', 'other'];

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_items',
      description: '批量创建日程条目：作业/比赛/考试/其他待办。用户一次说多件事时一次性提交。',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: '标题，简洁完整' },
                kind: { type: 'string', enum: KIND_ENUM, description: 'task=作业/一般待办，contest=比赛，exam=考试，other=其他' },
                due: { type: 'string', description: '截止时间，本地时间 YYYY-MM-DDTHH:mm；只有日期时给 YYYY-MM-DD' },
                start: { type: 'string', description: '开始时间（可选，比赛/考试有明确时段时）' },
                end: { type: 'string', description: '结束时间（可选）' },
                allDay: { type: 'boolean', description: '是否全天' },
                location: { type: 'string' },
                note: { type: 'string', description: '补充说明，如作业范围' },
                url: { type: 'string', description: '报名/比赛链接' },
                course: { type: 'string', description: '关联课程名（作业属于哪门课时填）' },
              },
              required: ['title', 'kind'],
            },
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_items',
      description: '修改已有条目：改标题、改截止时间、标记完成、改备注等。需要条目 id（可从 list_schedule 结果里看到）。',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                kind: { type: 'string', enum: KIND_ENUM },
                due: { type: 'string' },
                start: { type: 'string' },
                end: { type: 'string' },
                allDay: { type: 'boolean' },
                done: { type: 'boolean' },
                location: { type: 'string' },
                note: { type: 'string' },
                url: { type: 'string' },
              },
              required: ['id'],
            },
          },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_items',
      description: '删除条目（任务或课程），需要 id。用户说“删掉那个”时先 list_schedule 找到 id。',
      parameters: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'string' } } },
        required: ['ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_schedule',
      description: '查询某个时间段的课程与待办，用于回答“我今天/这周有什么”。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '起始日期 YYYY-MM-DD' },
          to: { type: 'string', description: '结束日期 YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_courses',
      description: '新增课程（用于用户口述加课/换课，课表批量导入走导入面板）。',
      parameters: {
        type: 'object',
        properties: {
          courses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                teacher: { type: 'string' },
                location: { type: 'string' },
                weekday: { type: 'number', description: '1=周一 … 7=周日' },
                startTime: { type: 'string', description: 'HH:mm' },
                endTime: { type: 'string', description: 'HH:mm' },
                weeks: { type: 'array', items: { type: 'number' }, description: '上课周次，如 [1..16]' },
              },
              required: ['title', 'weekday', 'startTime', 'endTime'],
            },
          },
        },
        required: ['courses'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_term',
      description: '修改学期信息：开学第一周的周一日期、总周数、学期名称。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          startDate: { type: 'string', description: '第 1 周周一，YYYY-MM-DD' },
          totalWeeks: { type: 'number' },
        },
      },
    },
  },
] as const;

export function nowText(now = new Date()): string {
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  return `${fmtDate(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}（${wd}）`;
}

export function buildSystemPrompt(state: AppState, now = new Date()): string {
  const { term } = state;
  const week = weekIndexOf(term.startDate, now);
  const periodTable = term.periods.map((p) => `第${p.index}节 ${p.start}-${p.end}`).join('，');
  const courses = state.courses.length
    ? state.courses.map((c) => `- ${summarizeCourse(c, term)}`).join('\n')
    : '（暂无课程）';
  const pending = state.tasks.filter((t) => !t.done);
  const taskLines = pending.length
    ? pending
        .slice(0, 30)
        .map((t) => `- [${t.kind}] ${t.title} | 截止 ${t.due ?? '无'}${t.course ? ` | 课程 ${t.course}` : ''} | id:${t.id}`)
        .join('\n')
    : '（暂无待办）';

  return `你是「日程罗盘」的日程助理，服务一名中国大学生。你把用户口语里的作业、比赛、考试、课程安排变成结构化日程，并回答日程问题。

当前时间：${nowText(now)}，时区 Asia/Shanghai。
学期：${term.name}；第 1 周从 ${term.startDate}（周一）开始，共 ${term.totalWeeks} 周；现在是第 ${week > 0 ? week : 1} 周。
作息：${periodTable}。

已有课程：
${courses}

未完成待办：
${taskLines}

规则：
1. 相对时间（明天、下周三、周五前、下个月）必须结合“当前时间”换算成具体日期；实在推不出就问一句，不要瞎猜。
2. 时间统一用本地时间字符串 YYYY-MM-DDTHH:mm，不带 Z、不带时区偏移。
3. “周五前交”这类只有日期的截止，写到当天 23:59；明确全天的事才设 allDay=true。
4. 一次可以建多条，用 add_items 批量提交；工具调用成功后不要逐条罗列，简短确认即可（≤3 行）。
5. 用户问“今天/这周/最近有什么”时，先调用 list_schedule 再回答，不要凭记忆。
6. 不编造用户没提过的作业、比赛或时间。
7. 中文回复，简洁干脆，不用 Markdown 标题和表格。
8. 如果用户说的事明显属于某门已有课程（如“高数作业”），在 course 字段填课程名。`;
}
