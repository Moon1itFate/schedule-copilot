import type { AppState } from '../src/types.js';
import { saveState } from './store.js';
import { addDays, normalizeDate, parseLocal, scheduleText } from './util.js';
import { courseFromInput, taskFromInput, updateTerm } from './validation.js';

export interface ToolResult {
  text: string;
  changed: boolean;
}

/** Validate a whole tool call before publishing any of its writes. */
export function executeTool(name: string, rawArgs: string, state: AppState): ToolResult {
  let args: Record<string, any>;
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error();
  } catch {
    return { text: '参数解析失败：需要合法的 JSON 对象，请重新调用。', changed: false };
  }
  const draft = structuredClone(state);
  try {
    const result = applyTool(name, args, draft);
    if (result.changed) {
      saveState(draft);
      Object.assign(state, draft);
    }
    return result;
  } catch (error) {
    return { text: `操作失败，未保存任何修改：${error instanceof Error ? error.message : String(error)}`, changed: false };
  }
}

function applyTool(name: string, args: Record<string, any>, state: AppState): ToolResult {
  switch (name) {
    case 'add_items': {
      const items = Array.isArray(args.items) ? args.items : [];
      const created = items.map((input) => {
        const task = taskFromInput(input ?? {});
        if (!task.due && task.start) task.due = task.start;
        return task;
      });
      if (!created.length) return { text: '没有可创建的条目：缺少 title。', changed: false };
      state.tasks.push(...created);
      return { text: `已创建 ${created.length} 条：${created.map((task) => `「${task.title}」${task.due ? `截止 ${task.due.replace('T', ' ')}` : ''}`).join('、')}`, changed: true };
    }

    case 'update_items': {
      const items = Array.isArray(args.items) ? args.items : [];
      const updated: string[] = [];
      for (const input of items) {
        const index = state.tasks.findIndex((task) => task.id === input?.id);
        if (index < 0) throw new Error('没有找到要修改的条目，请先 list_schedule 拿 id');
        const next = taskFromInput(input, state.tasks[index]);
        state.tasks[index] = next;
        updated.push(next.title);
      }
      return { text: updated.length ? `已更新 ${updated.length} 条：${updated.join('、')}` : '没有提供要修改的条目。', changed: updated.length > 0 };
    }

    case 'remove_items': {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      const before = state.tasks.length + state.courses.length;
      state.tasks = state.tasks.filter((task) => !ids.includes(task.id));
      state.courses = state.courses.filter((course) => !ids.includes(course.id));
      const removed = before - state.tasks.length - state.courses.length;
      return { text: removed ? `已删除 ${removed} 条。` : '没有匹配的 id，未删除任何内容。', changed: removed > 0 };
    }

    case 'list_schedule': {
      if (args.from !== undefined && !normalizeDate(args.from)) throw new Error('查询开始日期无效');
      if (args.to !== undefined && !normalizeDate(args.to)) throw new Error('查询结束日期无效');
      let from = args.from ? parseLocal(args.from) : new Date();
      let to = args.to ? parseLocal(args.to) : addDays(from, 13);
      if (to < from) [from, to] = [to, from];
      if (to.getTime() - from.getTime() > 366 * 86400000) throw new Error('一次最多查询一年日程');
      return { text: scheduleText(state, from, to), changed: false };
    }

    case 'add_courses': {
      const inputs = Array.isArray(args.courses) ? args.courses : [];
      const courses = inputs.map((input) => courseFromInput(input ?? {}, state.term));
      if (!courses.length) return { text: '没有可添加的课程：需要 title、weekday、startTime、endTime。', changed: false };
      state.courses.push(...courses);
      return { text: `已添加 ${courses.length} 门课：${courses.map((course) => course.title).join('、')}`, changed: true };
    }

    case 'set_term': {
      if (!['name', 'startDate', 'totalWeeks'].some((key) => args[key] !== undefined)) return { text: '没有有效的学期参数。', changed: false };
      updateTerm(state, args);
      return { text: `学期已更新：${state.term.name}，开学 ${state.term.startDate}，共 ${state.term.totalWeeks} 周。`, changed: true };
    }

    default:
      return { text: `未知工具：${name}`, changed: false };
  }
}
