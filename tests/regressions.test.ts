import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AppState } from '../src/types.js';

const dataDir = mkdtempSync(path.join(tmpdir(), 'schedule-regression-'));
process.env.SCHEDULE_DATA_DIR = path.join(dataDir, 'unit');
const { DEFAULT_PERIODS, DEFAULT_SETTINGS } = await import('../server/store.js');
const { normalizeDate, expandWeeks } = await import('../server/util.js');
const { handleLocalMessage } = await import('../server/localAgent.js');
const { importCourses } = await import('../server/importers.js');
const { buildIcs } = await import('../server/ics.js');
const { parseWeeks } = await import('../src/lib/weeks.js');
const { chatStream } = await import('../src/api.js');
const { executeTool } = await import('../server/tools.js');
const { runAgent } = await import('../server/agent.js');
const { getState, saveState } = await import('../server/store.js');
const { updateTerm } = await import('../server/validation.js');
const { periodTimeline, periodError, nextPeriod, editPeriod, setPeriodDuration } = await import('../src/lib/periods.js');
const { reminderFeed } = await import('../server/reminders.js');

function blank(): AppState {
  return { term: { name: '测试学期', startDate: '2026-09-14', totalWeeks: 18, periods: structuredClone(DEFAULT_PERIODS) }, courses: [], tasks: [] };
}

let child: ChildProcess;
let base: string;
before(async () => {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', SCHEDULE_DATA_DIR: path.join(dataDir, 'api') },
    windowsHide: true,
    stdio: 'pipe',
  });
  let logs = '';
  child.stdout?.on('data', (chunk) => { logs += chunk; });
  child.stderr?.on('data', (chunk) => { logs += chunk; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* waiting for startup */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`测试服务启动超时：${logs}`);
});
after(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

async function request(route: string, body?: unknown, method = 'POST') {
  const response = await fetch(`${base}${route}`, body === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as any };
}

test('拒绝不存在的日期和越界时间', () => {
  assert.equal(normalizeDate('2024-02-29 8:05'), '2024-02-29T08:05');
  for (const value of ['2026-02-30', '2026-13-01', '2026-10-26T25:70', '2026-10-26garbage']) {
    assert.equal(normalizeDate(value), undefined, value);
  }
});

test('本地助手正确理解明晚八点和今晚十二点', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-28T10:00:00') });
  for (const [input, due] of [['明晚八点写英语作文', '2026-10-29T20:00'], ['今晚十二点交报告', '2026-10-29T00:00']]) {
    const state = blank();
    handleLocalMessage(input, state);
    assert.equal(state.tasks[0]?.due, due, input);
  }
});

test('本周一与未指定本周的周一分别解析', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-28T10:00:00') });
  for (const [input, due] of [['本周一交报告', '2026-10-26T23:59'], ['周一交报告', '2026-11-02T23:59']]) {
    const state = blank();
    handleLocalMessage(input, state);
    assert.equal(state.tasks[0]?.due, due);
  }
});

test('查询明天只返回明天的安排', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-28T10:00:00') });
  const state = blank();
  for (const [title, due] of [['今天任务', '2026-10-28T12:00'], ['明天任务', '2026-10-29T12:00'], ['后天任务', '2026-10-30T12:00']]) {
    state.tasks.push({ id: title, title, due, kind: 'task', createdAt: '' });
  }
  const result = handleLocalMessage('明天有什么安排？', state);
  assert.match(result.text, /明天任务/);
  assert.doesNotMatch(result.text, /今天任务|后天任务/);
});

test('周次解析按每个范围分别处理单双周', async () => {
  const expected = [1, 3, 5, 7, 10, 12, 14, 16];
  assert.deepEqual(expandWeeks('1-8单周,10-16双周', 18), expected);
  assert.deepEqual(parseWeeks('1-8单周,10-16双周', 18), expected);
  const result = await importCourses({ mode: 'text', text: '篮球 周五 7-8节 2-16双周 东区体育馆', state: blank(), settings: DEFAULT_SETTINGS });
  assert.deepEqual(result.courses[0]?.weeks, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.equal(result.courses[0]?.title, '篮球');
});

test('ICS 导入按用户填写的开学日期计算周次', async () => {
  const source = blank();
  source.term.startDate = '2026-10-26';
  source.courses.push({ id: 'c1', title: '数学', weekday: 1, startTime: '08:00', endTime: '09:40', weeks: [1, 2], location: '201' });
  source.courses.push({ id: 'c2', title: '仅上一次的课程', weekday: 3, startTime: '08:00', endTime: '09:40', weeks: [2], teacher: '王老师' });
  const note = '中文备注，分号；换行\n'.repeat(25);
  source.tasks.push({ id: 'outside', title: '学期外全天安排', kind: 'other', due: '2027-06-01', allDay: true, done: true, note, createdAt: '' });
  const result = await importCourses({ mode: 'ics', text: buildIcs(source), termStart: '2026-10-26', state: blank(), settings: DEFAULT_SETTINGS });
  assert.deepEqual(result.courses[0]?.weeks, [1, 2]);
  assert.deepEqual(result.courses[1]?.weeks, [2]);
  assert.equal(result.courses[1]?.teacher, '王老师');
  assert.equal(result.tasks?.[0]?.due, '2027-06-01');
  assert.equal(result.tasks?.[0]?.allDay, true);
  assert.equal(result.tasks?.[0]?.done, true);
  assert.equal(result.tasks?.[0]?.note, note.trim());
});

test('编辑日程可以清空日期并修改全天标记', async () => {
  const created = await request('/api/tasks', { title: '测试清空', due: '2026-10-28T12:00', start: '2026-10-28T10:00', end: '2026-10-28T12:00', allDay: true });
  const updated = await request('/api/tasks', { id: created.data.task.id, due: '', start: '', end: '', allDay: false });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.task.due, undefined);
  assert.equal(updated.data.task.start, undefined);
  assert.equal(updated.data.task.end, undefined);
  assert.equal(updated.data.task.allDay, false);
});

test('拒绝错误课程时间，失败的编辑不会污染内存或磁盘', async () => {
  const created = await request('/api/courses', { title: '原课程', startTime: '08:00', endTime: '09:40', weeks: [1, 2] });
  const updated = await request('/api/courses', { id: created.data.course.id, title: '不应保存', startTime: '12:00', endTime: '08:00' });
  assert.equal(updated.status, 400);
  const saved = (await request('/api/state')).data.state.courses.find((course: any) => course.id === created.data.course.id);
  assert.equal(saved.title, '原课程');
  assert.equal(saved.startTime, '08:00');
});

test('无效任务日期返回明确错误', async () => {
  const result = await request('/api/tasks', { title: '无效日期', due: '2026-02-30T12:00' });
  assert.equal(result.status, 400);
});

test('ICS 预览提交不会丢失单次日程，任务专用导入保留课程', async () => {
  const source = blank();
  source.tasks.push({ id: 'single', title: '单次比赛', kind: 'contest', due: '2026-10-28T19:00', start: '2026-10-28T19:00', end: '2026-10-28T21:00', createdAt: '', done: true, note: '决赛' });
  const preview = await request('/api/import', { mode: 'ics', text: buildIcs(source), termStart: source.term.startDate });
  assert.equal(preview.data.tasks?.length, 1);
  const before = (await request('/api/state')).data.state;
  const committed = await request('/api/import', { mode: 'ics', commit: true, courses: [], tasks: preview.data.tasks, termStart: source.term.startDate });
  assert.equal(committed.status, 200);
  assert.equal(committed.data.state.courses.length, before.courses.length);
  const imported = committed.data.state.tasks.find((task: any) => task.title === '单次比赛');
  assert.equal(imported?.kind, 'contest');
  assert.equal(imported?.end, '2026-10-28T21:00');
  assert.equal(imported?.done, true);
});

test('聊天流支持 CRLF、尾部事件和连接中断', async (t) => {
  const chunks = ['data: {"type":"text","value":"你好"}\r\n\r\n', 'data: {"type":"text","value":"世界"}'];
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); },
  })));
  let text = '';
  await chatStream([], { onText: (value) => { text += value; }, onState() {}, onError() {} });
  assert.equal(text, '你好世界');
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error('连接中断')); },
  })));
  const errors: string[] = [];
  await assert.doesNotReject(chatStream([], { onText() {}, onState() {}, onError: (value) => errors.push(value) }));
  assert.match(errors.join(''), /连接中断/);
});

test('模型工具也执行日期校验，批量写入失败时不留下部分数据', () => {
  const state = blank();
  const result = executeTool('add_items', JSON.stringify({ items: [
    { title: '有效', due: '2026-10-28T12:00' }, { title: '无效', due: '2026-02-30T12:00' },
  ] }), state);
  assert.equal(result.changed, false);
  assert.equal(state.tasks.length, 0);
});

test('模型工具可以清空时间和全天标记', () => {
  const state = blank();
  state.tasks.push({ id: 'edit-tool', title: '修改', kind: 'task', due: '2026-10-28', allDay: true, createdAt: '' });
  const result = executeTool('update_items', JSON.stringify({ items: [{ id: 'edit-tool', due: null, allDay: false }] }), state);
  assert.equal(result.changed, true);
  assert.equal(state.tasks[0].due, undefined);
  assert.equal(state.tasks[0].allDay, false);
});

test('等待模型回复期间手动新增的数据不会被工具写入覆盖', async (t) => {
  saveState(blank());
  const stale = getState();
  const latest = blank();
  latest.tasks.push({ id: 'manual', title: '手动新增', kind: 'task', createdAt: '' });
  saveState(latest);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: calls++ === 0 ? {
    content: '', tool_calls: [{ id: 'add', function: { name: 'add_items', arguments: JSON.stringify({ items: [{ title: '模型新增' }] }) } }],
  } : { content: '已完成' } }] }));
  await runAgent({ history: [{ role: 'user', content: '新增任务' }], state: stale, settings: { ...DEFAULT_SETTINGS, localMode: false, baseUrl: 'http://127.0.0.1:1/v1' }, emit() {} });
  assert.deepEqual(getState().tasks.map((task) => task.title), ['手动新增', '模型新增']);
});

test('节次时间轴支持不等长课程、压缩午休，并准确映射节次边界', () => {
  const periods = [
    { index: 1, start: '07:30', end: '08:10' },
    { index: 2, start: '08:20', end: '09:20' },
    { index: 3, start: '14:00', end: '14:45' },
  ];
  const timeline = periodTimeline(periods, [{ start: 22 * 60, end: 23 * 60 }]);
  const teachingRows = timeline.rows.filter((row) => row.period);
  assert.equal(teachingRows.length, 3);
  assert.equal(teachingRows[0].height, teachingRows[1].height);
  assert.equal(timeline.position(7 * 60 + 30), 0);
  assert.equal(timeline.position(8 * 60 + 10), teachingRows[0].height);
  assert.equal(timeline.position(14 * 60), teachingRows[2].top);
  assert.equal(timeline.end, 23 * 60);
  assert.ok(timeline.position(22 * 60) < timeline.height);
  for (let minute = timeline.start + 1; minute <= timeline.end; minute++) {
    assert.ok(timeline.position(minute) > timeline.position(minute - 1));
  }
});

test('作息编辑校验重叠、空时间、跨日，并避免生成超过当天的节次', () => {
  assert.match(periodError([{ index: 1, start: '', end: '08:45' }]) ?? '', /完整时间/);
  assert.match(periodError([{ index: 1, start: '23:00', end: '00:30' }]) ?? '', /结束时间/);
  assert.match(periodError([
    { index: 1, start: '08:00', end: '09:00' }, { index: 2, start: '08:50', end: '09:45' },
  ]) ?? '', /重叠/);
  assert.equal(nextPeriod([{ index: 1, start: '23:00', end: '23:59' }]), null);
  assert.deepEqual(nextPeriod([{ index: 1, start: '08:00', end: '08:45' }]), { index: 2, start: '08:55', end: '09:40' });
});

test('修改作息只移动按节次对齐的课程，不改自定义时段', () => {
  const state = blank();
  state.courses = [
    { id: 'aligned', title: '节次课程', weekday: 1, startTime: '08:00', endTime: '09:40', weeks: [1], periods: [1, 2] },
    { id: 'custom', title: '自定义课程', weekday: 1, startTime: '08:05', endTime: '08:30', weeks: [1] },
  ];
  const periods = structuredClone(state.term.periods);
  periods[0] = { index: 1, start: '07:30', end: '08:10' };
  periods[1] = { index: 2, start: '08:20', end: '09:05' };
  updateTerm(state, { periods });
  assert.equal(state.courses[0].startTime, '07:30');
  assert.equal(state.courses[0].endTime, '09:05');
  assert.deepEqual(state.courses[0].periods, [1, 2]);
  assert.equal(state.courses[1].startTime, '08:05');
  assert.equal(state.courses[1].endTime, '08:30');
  const before = structuredClone(state);
  assert.throws(() => updateTerm(state, { periods: [periods[0]] }), /节次课程.*第 2 节/);
  assert.deepEqual(state, before);
});

test('作息接口拒绝无效时间，不会部分更新已有课程', async () => {
  const before = (await request('/api/state')).data.state;
  const result = await request('/api/term', { periods: [
    { start: '08:30', end: '09:15' }, { start: '09:00', end: '09:45' },
  ] }, 'PUT');
  assert.equal(result.status, 400);
  assert.deepEqual((await request('/api/state')).data.state, before);
});

test('固定课时与自动顺延可独立开关，保留课间和午休间隔', () => {
  const periods = structuredClone(DEFAULT_PERIODS);
  const independent = editPeriod(periods, 0, 'start', '08:10', { fixedDuration: false, duration: 45, shiftFollowing: false });
  assert.equal(independent[0].end, '08:45');
  assert.deepEqual(independent.slice(1), periods.slice(1));
  const fixedOnly = editPeriod(periods, 0, 'start', '08:10', { fixedDuration: true, duration: 45, shiftFollowing: false });
  assert.equal(fixedOnly[0].end, '08:55');
  assert.deepEqual(fixedOnly.slice(1), periods.slice(1));
  const shifted = editPeriod(periods, 0, 'end', '08:55', { fixedDuration: false, duration: 45, shiftFollowing: true });
  assert.equal(shifted[1].start, '09:05');
  assert.equal(shifted[4].start, '14:10');
  const lockedShifted = editPeriod(periods, 0, 'start', '08:20', { fixedDuration: true, duration: 45, shiftFollowing: true });
  assert.equal(lockedShifted[0].end, '09:05');
  assert.equal(lockedShifted[1].start, '09:15');
  assert.equal(lockedShifted[4].start, '14:20');
  const middle = editPeriod(periods, 4, 'start', '14:20', { fixedDuration: false, duration: 45, shiftFollowing: true });
  assert.deepEqual(middle.slice(0, 4), periods.slice(0, 4));
  assert.equal(middle[4].end, '15:05');
  assert.equal(middle[5].start, '15:15');
  assert.deepEqual(periods, DEFAULT_PERIODS);
});

test('统一课时可保持各节开始时间，或连同间隔顺延，并支持提前', () => {
  const periods = structuredClone(DEFAULT_PERIODS);
  const fixed = setPeriodDuration(periods, 50, false);
  assert.equal(fixed[0].end, '08:50');
  assert.equal(fixed[1].start, '08:55');
  const shifted = setPeriodDuration(periods, 50, true);
  assert.equal(shifted[0].end, '08:50');
  assert.equal(shifted[1].start, '09:00');
  assert.equal(shifted[4].start, '14:20');
  const earlier = editPeriod(periods, 0, 'start', '07:50', { fixedDuration: true, duration: 45, shiftFollowing: true });
  assert.equal(earlier[1].start, '08:45');
  assert.equal(earlier[4].start, '13:50');
  assert.equal(nextPeriod(fixed, 50)?.end, '21:45');
});

test('自动调整超出当天时整体拒绝，不部分修改或跨到第二天', () => {
  const periods = structuredClone(DEFAULT_PERIODS);
  assert.throws(() => editPeriod(periods, 0, 'start', '12:00', { fixedDuration: true, duration: 45, shiftFollowing: true }), /超出当天/);
  assert.throws(() => setPeriodDuration(periods, 240, true), /超出当天/);
  assert.deepEqual(periods, DEFAULT_PERIODS);
});

test('作息编辑选项保存后可读取，错误课时不会落库', async () => {
  const options = { fixedDuration: true, duration: 50, shiftFollowing: true };
  const saved = await request('/api/term', { periodEditing: options }, 'PUT');
  assert.equal(saved.status, 200);
  assert.deepEqual((await request('/api/state')).data.state.term.periodEditing, options);
  const invalid = await request('/api/term', { periodEditing: { ...options, duration: 0 } }, 'PUT');
  assert.equal(invalid.status, 400);
  assert.deepEqual((await request('/api/state')).data.state.term.periodEditing, options);
});

test('手机提醒只返回未来未完成任务，优先开始时间，全天任务按早九点', () => {
  const state = blank();
  const now = new Date('2026-10-28T08:00').getTime();
  state.tasks = [
    { id: 'done', title: '已完成', kind: 'task', due: '2026-10-28T10:00', done: true, createdAt: '' },
    { id: 'past', title: '已过期', kind: 'task', due: '2026-10-27T10:00', createdAt: '' },
    { id: 'no-date', title: '无时间', kind: 'task', createdAt: '' },
    { id: 'invalid', title: '无效日期', kind: 'task', due: '2026-02-30T10:00', createdAt: '' },
    { id: 'start', title: '比赛', kind: 'contest', due: '2026-10-28T22:00', start: '2026-10-28T19:00', createdAt: '' },
    { id: 'all-day', title: '全天', kind: 'task', allDay: true, due: '2026-10-28T23:59', createdAt: '' },
  ];
  const feed = reminderFeed(state, now);
  assert.deepEqual(feed.items.map((item) => item.id), ['all-day', 'start']);
  assert.equal(feed.items[0].at, new Date('2026-10-28T09:00').getTime());
  assert.equal(feed.items[1].at, new Date('2026-10-28T19:00').getTime());
});

test('手机缓存数据不包含模型配置和任务私有备注，最多返回最近一百项', () => {
  const state = blank();
  const now = new Date('2026-10-28T08:00').getTime();
  state.tasks = Array.from({ length: 110 }, (_, i) => ({ id: String(i), title: `任务${i}`, kind: 'task', due: '2026-10-29T10:00', note: '私有备注', url: 'https://private.example', createdAt: '' }));
  const feed = reminderFeed(state, now);
  assert.equal(feed.items.length, 100);
  assert.doesNotMatch(JSON.stringify(feed), /私有备注|private.example|apiKey|baseUrl/);
});

test('手机提醒接口会在任务完成后移除缓存候选', async () => {
  const created = await request('/api/tasks', { title: '手机缓存验证', due: '2099-10-28T12:00' });
  const before = await request('/api/reminders');
  assert.equal(before.status, 200);
  assert.ok(before.data.items.some((item: any) => item.id === created.data.task.id));
  await request('/api/tasks', { id: created.data.task.id, done: true });
  const after = await request('/api/reminders');
  assert.ok(after.data.items.every((item: any) => item.id !== created.data.task.id));
});
