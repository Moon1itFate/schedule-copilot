import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgent } from './agent.js';
import { runLocalAgent } from './localAgent.js';
import { buildIcs } from './ics.js';
import { importCourses } from './importers.js';
import { reminderFeed } from './reminders.js';
import {
  getSettings,
  getState,
  publicSettings,
  resetData,
  saveSettings,
  saveState,
} from './store.js';
import { weekIndexOf } from './util.js';
import { courseFromInput, taskFromInput, termFromInput, updateTerm } from './validation.js';

const app = express();
const PORT = Number(process.env.PORT ?? 8787);
// 默认监听所有网卡，手机 App 才能通过局域网访问；只想本机用时设 HOST=127.0.0.1
const HOST = process.env.HOST ?? '0.0.0.0';

app.use(express.json({ limit: '10mb' }));

// 允许 APK / 其它设备跨源访问（页面本身同源时用不到，留着方便调试）
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

const fail = (res: express.Response, error: unknown, status = 400) => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(status).json({ error: message });
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, version: 1 });
});

app.get('/api/reminders', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(reminderFeed(getState()));
});

app.get('/api/state', (_req, res) => {
  const state = getState();
  const now = new Date();
  res.json({
    state,
    settings: publicSettings(),
    week: weekIndexOf(state.term.startDate, now),
    today: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  });
});

app.put('/api/term', (req, res) => {
  try {
    const state = structuredClone(getState());
    updateTerm(state, req.body ?? {});
    saveState(state);
    res.json({ state });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const state = structuredClone(getState());
    const input = req.body ?? {};
    const id = typeof input.id === 'string' ? input.id : '';
    const existing = id ? state.tasks.find((t) => t.id === id) : undefined;
    if (id && !existing) return res.status(404).json({ error: '日程已被删除，请刷新后重试' });
    const task = taskFromInput(input, existing);
    if (existing) state.tasks[state.tasks.indexOf(existing)] = task;
    else state.tasks.push(task);
    saveState(state);
    res.json({ state, task });
  } catch (error) {
    fail(res, error);
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  const state = getState();
  state.tasks = state.tasks.filter((t) => t.id !== req.params.id);
  saveState(state);
  res.json({ state });
});

app.post('/api/courses', (req, res) => {
  try {
    const state = structuredClone(getState());
    const input = req.body ?? {};
    const id = typeof input.id === 'string' ? input.id : '';
    const existing = id ? state.courses.find((c) => c.id === id) : undefined;
    if (id && !existing) return res.status(404).json({ error: '课程已被删除，请刷新后重试' });
    const base = courseFromInput(input, state.term, existing);
    if (existing) state.courses[state.courses.indexOf(existing)] = base;
    else state.courses.push(base);
    saveState(state);
    res.json({ state, course: base });
  } catch (error) {
    fail(res, error);
  }
});

app.delete('/api/courses/:id', (req, res) => {
  const state = getState();
  state.courses = state.courses.filter((c) => c.id !== req.params.id);
  saveState(state);
  res.json({ state });
});

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body ?? {};
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  const send = (event: unknown) => {
    if (closed) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const state = getState();
  const settings = getSettings();

  if (settings.localMode) {
    runLocalAgent(
      Array.isArray(messages) ? messages : [],
      state,
      (event) => send(event),
    );
  } else {
    await runAgent({
      history: Array.isArray(messages) ? messages : [],
      state,
      settings,
      emit: send,
    });
  }

  if (!closed) {
    res.write('data: {"type":"end"}\n\n');
    res.end();
  }
});

app.post('/api/import', async (req, res) => {
  try {
    const { mode, text, url, cookie, termStart, commit, courses: provided, tasks: providedTasks } = req.body ?? {};
    if (!['text', 'url', 'ics'].includes(mode)) throw new Error('未知的导入方式');
    let state = structuredClone(getState());

    if (commit && Array.isArray(provided)) {
      if (termStart !== undefined) state.term = termFromInput({ startDate: termStart }, state.term);
      const cleaned = provided.map((input: any) => courseFromInput(input ?? {}, state.term));
      if (providedTasks !== undefined && !Array.isArray(providedTasks)) throw new Error('单次日程必须为数组');
      const tasks = (providedTasks ?? []).map((input: any) => taskFromInput(input ?? {}));
      if (!cleaned.length && !tasks.length) throw new Error('请选择要导入的课程或日程');
      if (cleaned.length) state.courses = cleaned;
      state.tasks.push(...tasks);
      saveState(state);
      return res.json({ courses: cleaned, tasks, notes: [`已导入 ${cleaned.length} 门课程、${tasks.length} 个单次日程。`], taskCount: tasks.length, state });
    }

    const result = await importCourses({
      mode,
      text,
      url,
      cookie,
      termStart,
      settings: getSettings(),
      state,
    });

    if (commit) {
      state = structuredClone(getState());
      if (result.courses.length) {
        state.courses = result.courses;
      }
      const start = result.termStart ?? termStart;
      if (start !== undefined) state.term = termFromInput({ startDate: start }, state.term);
      if (result.tasks?.length) state.tasks.push(...result.tasks);
      saveState(state);
    }

    console.log(
      `[import] mode=${mode} chars=${String(text ?? '').length} courses=${result.courses.length} commit=${Boolean(commit)} notes=${result.notes.join(' / ').slice(0, 120)}`,
    );

    res.json({
      courses: result.courses,
      notes: result.notes,
      termStart: result.termStart,
      taskCount: result.tasks?.length ?? 0,
      tasks: result.tasks ?? [],
      state: commit ? state : undefined,
    });
  } catch (error) {
    fail(res, error);
  }
});

app.get('/api/settings', (_req, res) => {
  res.json(publicSettings());
});

app.put('/api/settings', (req, res) => {
  try {
    const { baseUrl, model, apiKey, temperature, localMode } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof baseUrl === 'string' && baseUrl.trim()) patch.baseUrl = baseUrl.trim();
    if (typeof model === 'string' && model.trim()) patch.model = model.trim();
    if (typeof apiKey === 'string' && apiKey.trim()) patch.apiKey = apiKey.trim();
    if (apiKey === null) patch.apiKey = '';
    if (typeof localMode === 'boolean') patch.localMode = localMode;
    if (Number.isFinite(Number(temperature))) patch.temperature = Math.min(2, Math.max(0, Number(temperature)));
    const next = saveSettings(patch);
    res.json({ ...publicSettings(), ok: true, model: next.model });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/settings/test', async (req, res) => {
  try {
    const body = req.body ?? {};
    const current = getSettings();
    const baseUrl = String(body.baseUrl || current.baseUrl).trim().replace(/\/+$/, '');
    const model = String(body.model || current.model).trim();
    const apiKey = String(body.apiKey || current.apiKey).trim();
    const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(baseUrl);
    if (!apiKey && !isLocal) throw new Error('请先填写 API Key');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`连不上 ${baseUrl}：${reason}。检查网络、Base URL 是否写错，或电脑是否断网。`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.warn(`[settings/test] ${response.status} ${baseUrl} ${model}: ${text.slice(0, 200)}`);
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          'API Key 无效，或这个 Key 与 Base URL 不配套（比如把中转站的 Key 填到了官方地址）。请核对 Key、Base URL、模型名是否来自同一个服务商。',
        );
      }
      if (response.status === 404) {
        throw new Error('接口地址 404：Base URL 应形如 https://api.deepseek.com/v1，不要带 /chat/completions，也不要少写 /v1。');
      }
      if (response.status === 402) throw new Error('账户余额不足（402），充值后再试。');
      if (response.status === 429) throw new Error('请求太频繁或额度用完（429），稍后再试。');
      if (response.status >= 500) throw new Error(`服务商暂时故障（${response.status}），过一会儿再试。`);
      throw new Error(`连接失败（${response.status}）：${text.slice(0, 300)}`);
    }
    res.json({ ok: true, message: `连接成功，模型 ${model} 可用。` });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/data/reset', (req, res) => {
  try {
    const demo = Boolean(req.body?.demo);
    const state = resetData(demo);
    res.json({ state });
  } catch (error) {
    fail(res, error);
  }
});

function lanAddresses(): { url: string; iface: string }[] {
  const list: { url: string; iface: string }[] = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      list.push({ url: `http://${info.address}:${PORT}`, iface: name });
    }
  }
  const rank = (name: string) =>
    /WLAN|Wi-?Fi|Ethernet|以太网|无线/i.test(name) ? 0 : /VPN|Surfshark|Radmin|OpenVPN|TAP|TUN/i.test(name) ? 2 : 1;
  return list.sort((a, b) => rank(a.iface) - rank(b.iface));
}

function lanUrls(): string[] {
  return lanAddresses().map((item) => item.url);
}

app.get('/api/addresses', (_req, res) => {
  res.json({ addresses: lanAddresses(), port: PORT });
});

app.get('/app.apk', (_req, res) => {
  const file = path.resolve(process.cwd(), 'ScheduleCopilot.apk');
  if (!fs.existsSync(file)) {
    res.status(404).send('APK 还没构建：在电脑上运行 scripts/build-apk.ps1');
    return;
  }
  res.download(file, 'ScheduleCopilot.apk');
});

app.get('/api/export.ics', (_req, res) => {
  const state = getState();
  const ics = buildIcs(state);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="schedule.ics"; filename*=UTF-8''${encodeURIComponent('日程罗盘.ics')}`);
  res.send(ics);
});

const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  if (res.headersSent) return;
  res.status(500).json({ error: message });
});

app.listen(PORT, HOST, () => {
  const hasDist = fs.existsSync(distDir);
  console.log(`[日程罗盘] API + 静态服务已启动: http://127.0.0.1:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const url of lanUrls()) console.log(`[日程罗盘] 手机 / 局域网访问: ${url}`);
    const first = lanUrls()[0];
    if (first && fs.existsSync(path.resolve(process.cwd(), 'ScheduleCopilot.apk'))) {
      console.log(`[日程罗盘] 手机直接下载安装包: ${first}/app.apk`);
    }
    console.log('[日程罗盘] 只想本机访问可设 HOST=127.0.0.1；首次手机连不上时，检查 Windows 防火墙是否放行 node。');
  }
  console.log(hasDist ? '[日程罗盘] 正在提供 dist/ 构建产物' : '[日程罗盘] 未找到 dist/，开发模式请用 npm run dev 打开 Vite 页面');
});
