import type { AppState } from '../types';
import { getState, saveState, getSettings, saveSettings, publicSettings, resetData } from './store';
import { courseFromInput, taskFromInput, updateTerm, termFromInput } from '../../server/validation';
import { runAgent } from '../../server/agent';
import { runLocalAgent } from '../../server/localAgent';
import { importCourses } from '../../server/importers';
import { buildIcs } from '../../server/ics';
import { fmtDate, weekIndexOf } from '../../server/util';
const networkFetch = window.fetch.bind(window);
const pending = new Map<string, { resolve: (response: Response) => void; reject: (error: Error) => void; timer: number }>();
window.phoneHttpResult = (id, raw) => {
  const call = pending.get(id); if (!call) return;
  pending.delete(id); window.clearTimeout(call.timer);
  try {
    const result = JSON.parse(raw);
    if (result.error) call.reject(new Error(result.error));
    else call.resolve(new Response(result.body, { status: result.status, headers: { 'Content-Type': result.contentType || 'application/json' } }));
  } catch { call.reject(new Error('网络返回格式异常')); }
};
async function remote(url: string, init?: RequestInit): Promise<Response> {
  if (!navigator.onLine) throw new Error('当前没有网络。课表和待办仍可离线使用，AI 请联网后重试。');
  if (!window.Phone) return networkFetch(url, init);
  if (init?.signal?.aborted) throw new Error('请求已取消');
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const cancel = () => { const item = pending.get(id); if (item) { clearTimeout(item.timer); pending.delete(id); reject(new Error('网络请求超时或已取消，请联网后重试')); } };
    const timer = window.setTimeout(cancel, 125000);
    pending.set(id, { resolve, reject, timer });
    init?.signal?.addEventListener('abort', cancel, { once: true });
    window.Phone!.http(id, url, JSON.stringify({ method: init?.method || 'GET', headers: Object.fromEntries(new Headers(init?.headers)), body: init?.body || '' }));
  });
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
async function localApi(route: string, method: string, body: any): Promise<Response> {
  const state = getState();
  switch (route) {
    case '/api/state': return json({ state, settings: publicSettings(), week: weekIndexOf(state.term.startDate, new Date()), today: fmtDate(new Date()) });
    case '/api/addresses': return json({ addresses: [], port: 0 });
    case '/api/settings':
      if (method === 'PUT') {
        const patch: Record<string, any> = {};
        for (const key of ['baseUrl', 'model', 'apiKey']) if (typeof body[key] === 'string' && body[key].trim()) patch[key] = body[key].trim();
        if (body.apiKey === null) patch.apiKey = '';
        if (typeof body.localMode === 'boolean') patch.localMode = body.localMode;
        if (Number.isFinite(body.temperature)) patch.temperature = Math.max(0, Math.min(2, body.temperature));
        saveSettings(patch);
      }
      return json({ ...publicSettings(), ok: true });
    case '/api/settings/test': {
      const current = getSettings();
      const base = String(body.baseUrl || current.baseUrl).replace(/\/+$/, '');
      const key = body.apiKey || current.apiKey;
      if (!key && !/localhost|127\.0\.0\.1/.test(base)) throw new Error('请先填写 API Key');
      const response = await remote(`${base}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model: body.model || current.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 }), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`模型连接失败（${response.status}），请检查接口地址、Key 和账户额度。`);
      return json({ ok: true, message: '连接成功，手机可直接使用此模型。' });
    }
    case '/api/term': updateTerm(state, body); saveState(state); return json({ state });
    case '/api/tasks': {
      const existing = state.tasks.find(t => t.id === body.id);
      if (body.id && !existing) throw new Error('日程已被删除');
      const task = taskFromInput(body, existing);
      if (existing) state.tasks[state.tasks.indexOf(existing)] = task; else state.tasks.push(task);
      saveState(state); return json({ state, task });
    }
    case '/api/courses': {
      const existing = state.courses.find(t => t.id === body.id);
      if (body.id && !existing) throw new Error('课程已被删除');
      const course = courseFromInput(body, state.term, existing);
      if (existing) state.courses[state.courses.indexOf(existing)] = course; else state.courses.push(course);
      saveState(state); return json({ state, course });
    }
    case '/api/data/reset': return json({ state: resetData(Boolean(body.demo)) });
    case '/api/import': {
      let result;
      if (body.commit && Array.isArray(body.courses)) {
        if (body.termStart !== undefined) state.term = termFromInput({ startDate: body.termStart }, state.term);
        result = { courses: body.courses.map((c: any) => courseFromInput(c, state.term)), tasks: (body.tasks || []).map((t: any) => taskFromInput(t)), notes: ['已导入手机本地存储。'] };
        if (!result.courses.length && !result.tasks.length) throw new Error('请选择要导入的安排');
      } else {
        result = await importCourses({ ...body, state, settings: getSettings() });
      }
      if (body.commit) {
        // Parsing may await the network; commit against the latest state to retain concurrent edits.
        const latest = getState();
        const start = ('termStart' in result ? result.termStart : undefined) || body.termStart;
        if (start) latest.term = termFromInput({ startDate: start }, latest.term);
        if (result.courses.length) latest.courses = result.courses;
        latest.tasks.push(...(result.tasks || [])); saveState(latest);
        return json({ ...result, taskCount: result.tasks?.length || 0, tasks: result.tasks || [], state: latest });
      }
      return json({ ...result, taskCount: result.tasks?.length || 0, tasks: result.tasks || [] });
    }
    case '/api/chat': {
      const settings = getSettings();
      const stream = new ReadableStream({ async start(controller) {
        const emit = (event: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        try {
          if (settings.localMode) runLocalAgent(body.messages || [], state, emit);
          else if (!navigator.onLine) emit({ type: 'error', value: '当前离线，AI 请联网后使用。课表和待办可以继续使用。' });
          else await runAgent({ history: body.messages || [], state, settings, emit });
        } catch (e) { emit({ type: 'error', value: e instanceof Error ? e.message : String(e) }); }
        finally { emit({ type: 'end' }); controller.close(); }
      } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    default:
      if (method === 'DELETE' && route.startsWith('/api/tasks/')) state.tasks = state.tasks.filter(t => t.id !== decodeURIComponent(route.slice(11)));
      else if (method === 'DELETE' && route.startsWith('/api/courses/')) state.courses = state.courses.filter(t => t.id !== decodeURIComponent(route.slice(13)));
      else throw new Error('手机暂不支持此操作');
      saveState(state); return json({ state });
  }
}
export function exportPhoneFile(name: string, mime: string, text: string) {
  if (window.Phone) window.Phone.exportFile(name, mime, text);
  else {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
export function restorePhoneBackup(raw: string) {
  const data = JSON.parse(raw);
  const input = data.state || data;
  if (!input.term || !Array.isArray(input.courses) || !Array.isArray(input.tasks)) throw new Error('备份文件格式无效');
  const restored: AppState = { term: termFromInput(input.term, getState().term), courses: [], tasks: [] };
  const ids = new Set<string>();
  const id = (value: unknown) => {
    const result = typeof value === 'string' && value && !ids.has(value) ? value : crypto.randomUUID(); ids.add(result); return result;
  };
  restored.courses = input.courses.map((c: any) => ({ ...courseFromInput(c, restored.term), id: id(c.id) }));
  restored.tasks = input.tasks.map((t: any) => ({ ...taskFromInput(t), id: id(t.id) }));
  saveState(restored);
}
export function bootPhone() {
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      try { return await localApi(url.pathname, init?.method || 'GET', init?.body ? JSON.parse(String(init.body)) : {}); }
      catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
    }
    return remote(url.href, init);
  };
  document.addEventListener('click', (event) => {
    const a = (event.target as Element)?.closest('a');
    if (a?.getAttribute('href') === '/api/export.ics') {
      event.preventDefault(); exportPhoneFile('日程罗盘.ics', 'text/calendar', buildIcs(getState()));
    }
  });
}
