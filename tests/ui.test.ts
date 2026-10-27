import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright-core';

const browserPath = process.env.SCHEDULE_BROWSER_PATH ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
if (!browserPath) throw new Error('请设置 SCHEDULE_BROWSER_PATH 为 Chrome / Edge 的可执行文件路径');
const dataDir = mkdtempSync(path.join(tmpdir(), 'schedule-ui-'));
let child: ChildProcess;
let base: string;
let browser: Browser;
let page: Page;
const errors: string[] = [];

async function api(route: string, data?: unknown, method = 'POST') {
  const response = await fetch(`${base}${route}`, data === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  assert.ok(response.ok, await response.clone().text());
  return response.json() as Promise<any>;
}

before(async () => {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), SCHEDULE_DATA_DIR: dataDir },
    windowsHide: true, stdio: 'pipe',
  });
  let logs = '';
  child.stdout?.on('data', (chunk) => { logs += chunk; });
  child.stderr?.on('data', (chunk) => { logs += chunk; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { ready = (await fetch(`${base}/api/health`)).ok; } catch { /* startup */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, logs);
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
});
beforeEach(async () => {
  await page?.close();
  await api('/api/data/reset', { demo: false });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, hasTouch: true });
  page.setDefaultTimeout(5000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('dialog', (dialog) => dialog.accept());
});
after(async () => {
  await browser?.close();
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
  rmSync(dataDir, { recursive: true, force: true });
  assert.deepEqual(errors, [], '浏览器控制台无错误');
});

async function selectView(label: string) {
  await page.getByRole('button', { name: '切换视图', exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function settleWeek() {
  await page.locator('.week-pages').evaluate(async node => {
    for (let i = 0; i < 5; i++) {
      await Promise.all(node.getAnimations().map(a => a.finished.catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!node.getAnimations().length) return;
    }
  });
}

async function swipeWeek(dx: number, dy = 0) {
  const client = await page.context().newCDPSession(page);
  const startX = dx < 0 ? 270 : 90, startY = 430;
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] });
    for (let i = 1; i <= 8; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + dx * i / 8, y: startY + dy * i / 8 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settleWeek();
  } finally { await client.detach(); }
}

test('手机左右滑动切换周次，学期边界不越界，纵向滚动不翻周', async () => {
  await api('/api/term', { startDate: '2020-01-06', totalWeeks: 2 }, 'PUT');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.locator('.week-scroll').waitFor();
  await swipeWeek(150);
  assert.match(await page.locator('.weeknav-label').innerText(), /第 1 周/);
  await swipeWeek(150);
  assert.match(await page.locator('.weeknav-label').innerText(), /第 1 周/);
  await swipeWeek(-150);
  assert.match(await page.locator('.weeknav-label').innerText(), /第 2 周/);
  await swipeWeek(-150);
  assert.match(await page.locator('.weeknav-label').innerText(), /第 2 周/);
  await swipeWeek(-15, -130);
  assert.match(await page.locator('.weeknav-label').innerText(), /第 2 周/);
  await page.locator('.week-scroll').focus();
  await page.keyboard.press('ArrowLeft');
  assert.match(await page.locator('.weeknav-label').innerText(), /第 1 周/);
  await page.getByRole('button', { name: '回到本周', exact: true }).click();
  assert.match(await page.locator('.weeknav-label').innerText(), /第 2 周/);
});

test('从界面清空日程日期后重新打开仍为空', async () => {
  await api('/api/tasks', { title: '可清空的日程', due: '2026-10-28T12:00', start: '2026-10-28T10:00', end: '2026-10-28T12:00' });
  await page.goto(base);
  await selectView('待办');
  await page.getByRole('button', { name: /可清空的日程/ }).click();
  for (const label of ['截止时间', '开始（可选）', '结束（可选）']) await page.getByLabel(label, { exact: true }).fill('');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /可清空的日程/ }).click();
  assert.equal(await page.getByLabel('截止时间', { exact: true }).inputValue(), '');
  const state = (await api('/api/state')).state;
  assert.equal(state.tasks[0].due, undefined);
  assert.equal(state.tasks[0].start, undefined);
  assert.equal(state.tasks[0].end, undefined);
});

test('仅包含单次日程的 ICS 可以在预览中勾选并导入', async () => {
  await page.goto(base);
  await page.getByRole('button', { name: '导入课表', exact: true }).first().click();
  await page.getByRole('button', { name: 'ICS 文件', exact: true }).click();
  const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ui-single\r\nDTSTART:20261029T190000\r\nDTEND:20261029T210000\r\nSUMMARY:界面导入测试比赛\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'test.ics', mimeType: 'text/calendar', buffer: Buffer.from(ics) });
  await page.getByRole('button', { name: '解析预览', exact: true }).click();
  await page.locator('.preview-row').waitFor();
  assert.match(await page.locator('.preview-row').innerText(), /界面导入测试比赛/);
  await page.getByRole('button', { name: '导入 1 项安排', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const state = (await api('/api/state')).state;
  assert.equal(state.tasks[0].title, '界面导入测试比赛');
  assert.equal(state.tasks[0].end, '2026-10-29T21:00');
});

test('中文输入法选词回车不会意外发送，断流后可以继续发送', async () => {
  await page.goto(base);
  const input = page.locator('.composer textarea');
  await input.fill('明天交报告');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
  assert.equal(await input.inputValue(), '明天交报告');
  assert.equal(await page.locator('.msg-user').count(), 0);
  await page.route('**/api/chat', (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: {"type":"error","value":"测试连接中断"}\r\n\r\n' }));
  await input.press('Enter');
  await page.getByText('⚠️ 测试连接中断', { exact: true }).waitFor();
  await input.fill('后天交报告');
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isEnabled(), true);
});

test('320px 手机界面无横向溢出，导入和设置可以打开', async () => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(base);
  await page.locator('.week-inner').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole('button', { name: '导入课表', exact: true }).first().click();
  await page.getByRole('dialog').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.keyboard.press('Escape');
  await page.locator('.topbar').getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('dialog').waitFor();
});

test('手机课表七天完整显示，窄课程卡片换行且周日课程可直接编辑', async () => {
  await api('/api/term', { startDate: '2026-10-26', totalWeeks: 1 }, 'PUT');
  for (let weekday = 1; weekday <= 7; weekday++) {
    await api('/api/courses', { title: `数据结构与算法${weekday}`, weekday, startTime: '08:00', endTime: '09:40', location: '综合楼2102', teacher: '王老师', weeks: [1] });
  }
  await page.goto(base);
  await page.locator('.event-block').last().waitFor();
  for (const width of [320, 360, 390, 430, 540, 720]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.locator('.week-scroll').evaluate((node) => node.scrollWidth <= node.clientWidth + 1), `${width}px：课表无需横向滚动`);
    const heads = await page.locator('.day-head').all();
    assert.equal(heads.length, 7);
    for (const head of heads) {
      const box = await head.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, `${width}px：七天都在屏幕内`);
    }
    assert.equal(await page.locator('.event-title').first().evaluate((node) => getComputedStyle(node).whiteSpace), 'normal');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/liquid-glass-mobile.png' });
  await page.getByRole('button', { name: '切换视图', exact: true }).click();
  await page.screenshot({ path: 'docs/liquid-glass-mobile-menu.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.locator('.event-block').filter({ hasText: '数据结构与算法7' }).click();
  assert.equal(await page.getByLabel('课程名', { exact: true }).inputValue(), '数据结构与算法7');
});

test('节次时间段可点击编辑，保存后课程对齐且刷新后保留', async () => {
  const created = await api('/api/courses', { title: '跟随节次的课程', weekday: 1, startTime: '08:00', endTime: '09:40' });
  await api('/api/courses', { title: '固定时间的课程', weekday: 2, startTime: '08:05', endTime: '08:30' });
  await page.goto(base);
  await page.locator('.period-label').first().waitFor();
  assert.match(await page.locator('.period-label').first().innerText(), /8:00～8:45/);
  assert.equal(await page.locator('.hour-label').count(), 0);
  await page.locator('.period-label').first().click();
  await page.getByLabel('第 1 节开始时间', { exact: true }).fill('07:30');
  await page.getByLabel('第 1 节结束时间', { exact: true }).fill('08:10');
  await page.getByLabel('第 2 节开始时间', { exact: true }).fill('08:20');
  await page.getByLabel('第 2 节结束时间', { exact: true }).fill('09:05');
  await page.getByRole('button', { name: '保存作息', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const state = (await api('/api/state')).state;
  const course = state.courses.find((item: any) => item.id === created.course.id);
  assert.equal(course.startTime, '07:30');
  assert.equal(course.endTime, '09:05');
  assert.equal(state.courses.find((item: any) => item.title === '固定时间的课程').startTime, '08:05');
  await page.reload();
  await page.locator('.period-label').first().waitFor();
  assert.match(await page.locator('.period-label').first().innerText(), /7:30～8:10/);
  const axis = await page.locator('.period-label').first().boundingBox();
  const block = await page.locator('.event-block').filter({ hasText: '跟随节次的课程' }).boundingBox();
  assert.ok(axis && block && Math.abs(block.y - axis.y - 2) <= 1, '课程与节次起点一致');
});

test('手机可以增删节次，错误时间阻止保存，取消不修改作息', async () => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(base);
  await page.getByRole('button', { name: '设置作息时间', exact: true }).click();
  await page.getByLabel('第 1 节开始时间', { exact: true }).fill('09:00');
  assert.equal(await page.getByRole('button', { name: '保存作息', exact: true }).isDisabled(), true);
  assert.match(await page.getByRole('alert').innerText(), /结束时间/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '设置作息时间', exact: true }).click();
  assert.equal(await page.getByLabel('第 1 节开始时间', { exact: true }).inputValue(), '08:00');
  await page.getByRole('button', { name: '添加一节', exact: true }).click();
  await page.getByLabel('第 11 节开始时间', { exact: true }).fill('21:10');
  await page.getByLabel('第 11 节结束时间', { exact: true }).fill('21:55');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const row = await page.locator('.period-editor-row').last().boundingBox();
  assert.ok(row && row.x >= 0 && row.x + row.width <= 320, '时间编辑行完整显示在手机视口中');
  await page.getByRole('button', { name: '保存作息', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.period-label').count(), 11);
  assert.match(await page.locator('.period-label').last().getAttribute('aria-label') ?? '', /21:10～21:55/);
  await page.getByRole('button', { name: '设置作息时间', exact: true }).click();
  await page.getByRole('button', { name: '删除第 11 节', exact: true }).click();
  await page.getByRole('button', { name: '保存作息', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.period-label').count(), 10);
});

test('手机固定课时并顺延，保存后重开保留选项，关闭顺延恢复单节编辑', async () => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(base);
  await page.getByRole('button', { name: '设置作息时间', exact: true }).click();
  await page.getByLabel('固定每节课时长', { exact: true }).check();
  await page.getByLabel('自动顺延后续节次', { exact: true }).check();
  await page.getByLabel('第 1 节开始时间', { exact: true }).fill('08:20');
  assert.equal(await page.getByLabel('第 1 节结束时间', { exact: true }).inputValue(), '09:05');
  assert.equal(await page.getByLabel('第 1 节结束时间', { exact: true }).isEditable(), false);
  assert.equal(await page.getByLabel('第 2 节开始时间', { exact: true }).inputValue(), '09:15');
  assert.equal(await page.getByLabel('第 5 节开始时间', { exact: true }).inputValue(), '14:20');
  await page.getByLabel('每节课时长（分钟）', { exact: true }).fill('50');
  assert.equal(await page.getByLabel('第 1 节结束时间', { exact: true }).inputValue(), '09:10');
  assert.equal(await page.getByLabel('第 2 节开始时间', { exact: true }).inputValue(), '09:20');
  assert.equal(await page.getByLabel('第 5 节开始时间', { exact: true }).inputValue(), '14:40');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: '保存作息', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.reload();
  await page.getByRole('button', { name: '设置作息时间', exact: true }).click();
  assert.equal(await page.getByLabel('固定每节课时长', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('自动顺延后续节次', { exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('每节课时长（分钟）', { exact: true }).inputValue(), '50');
  await page.getByLabel('自动顺延后续节次', { exact: true }).uncheck();
  await page.getByLabel('第 1 节开始时间', { exact: true }).fill('08:10');
  assert.equal(await page.getByLabel('第 1 节结束时间', { exact: true }).inputValue(), '09:00');
  assert.equal(await page.getByLabel('第 2 节开始时间', { exact: true }).inputValue(), '09:20');
  await page.getByLabel('固定每节课时长', { exact: true }).uncheck();
  await page.getByLabel('第 1 节结束时间', { exact: true }).fill('09:05');
  assert.equal(await page.getByLabel('第 2 节开始时间', { exact: true }).inputValue(), '09:20');
});

test('仅顺延模式允许改下课时间，清空再输入能恢复，跨日调整显示错误', async () => {
  await page.goto(base);
  await page.getByRole('button', { name: '设置作息时间', exact: true }).click();
  await page.getByLabel('自动顺延后续节次', { exact: true }).check();
  await page.getByLabel('第 1 节结束时间', { exact: true }).fill('');
  assert.equal(await page.getByRole('button', { name: '保存作息', exact: true }).isDisabled(), true);
  await page.getByLabel('第 1 节结束时间', { exact: true }).fill('08:55');
  assert.equal(await page.getByLabel('第 2 节开始时间', { exact: true }).inputValue(), '09:05');
  assert.equal(await page.getByLabel('第 5 节开始时间', { exact: true }).inputValue(), '14:10');
  await page.getByLabel('第 1 节开始时间', { exact: true }).fill('12:00');
  assert.match(await page.getByRole('alert').innerText(), /超出当天/);
  assert.equal(await page.getByLabel('第 1 节开始时间', { exact: true }).inputValue(), '08:00');
  assert.equal(await page.getByLabel('第 2 节开始时间', { exact: true }).inputValue(), '09:05');
});

test('统一课时加长产生重叠后，开启自动顺延可以直接修正', async () => {
  await page.goto(base);
  await page.getByRole('button', { name: '设置作息时间', exact: true }).click();
  await page.getByLabel('固定每节课时长', { exact: true }).check();
  await page.getByLabel('每节课时长（分钟）', { exact: true }).fill('60');
  assert.match(await page.getByRole('alert').innerText(), /重叠/);
  await page.getByLabel('自动顺延后续节次', { exact: true }).check();
  assert.equal(await page.getByLabel('第 2 节开始时间', { exact: true }).inputValue(), '09:10');
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.equal(await page.getByRole('button', { name: '保存作息', exact: true }).isEnabled(), true);
});

test('手机视口可预览胶囊提醒，点击后打开对应任务', async () => {
  await api('/api/tasks', { title: '胶囊提醒对应任务', due: '2099-10-28T12:00' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.locator('.topbar').getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '预览流动岛提醒', exact: true }).click();
  const capsule = page.getByRole('status', { name: '任务提醒预览', exact: true });
  await capsule.waitFor();
  assert.match(await capsule.innerText(), /胶囊提醒对应任务/);
  const box = await capsule.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
  await capsule.getByRole('button', { name: '查看任务 →', exact: true }).click();
  assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '胶囊提醒对应任务');
});

test('通知任务深链接打开编辑窗，找不到任务时正常显示待办', async () => {
  const created = await api('/api/tasks', { title: '通知点击验证', due: '2099-10-28T12:00' });
  await page.goto(`${base}/?task=${encodeURIComponent(created.task.id)}`);
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByLabel('标题', { exact: true }).inputValue(), '通知点击验证');
  assert.ok(!new URL(page.url()).searchParams.has('task'));
  await page.goto(`${base}/?task=deleted-task`);
  await page.locator('.todo-view').waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
});

test('新版安卓容器显示原生提醒入口，网页显示下载入口', async () => {
  await page.goto(base);
  await page.locator('.topbar').getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await page.getByRole('link', { name: '下载新版安卓 App', exact: true }).getAttribute('href'), '/app.apk');
  const native = await browser.newPage({ userAgent: 'Android WebView ScheduleCopilot/0.4' });
  try {
    await native.goto(base);
    await native.locator('.topbar').getByRole('button', { name: '设置', exact: true }).click();
    assert.equal(await native.getByRole('link', { name: '设置手机提醒', exact: true }).getAttribute('href'), 'schedulecopilot://reminder-settings');
  } finally { await native.close(); }
});

test('液态玻璃层不遮挡操作，320px 到桌面尺寸的导航完整可见', async () => {
  await page.goto(base);
  await page.locator('.glass__warp').first().waitFor({ state: 'attached' });
  assert.ok(await page.locator('.glass__warp').count() >= 3, '实际渲染 liquid-glass-react 光学层');
  assert.equal(await page.locator('.liquid-lens').first().evaluate((node) => getComputedStyle(node).pointerEvents), 'none');
  for (const width of [320, 390, 768, 1120, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 960 });
    for (const name of ['回到本周', '导入课表', '设置']) {
      const button = page.locator('.topbar').getByRole('button', { name, exact: true });
      const bounds = await button.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${width}px：${name} 完整可见`);
    }
    const menu = await page.getByRole('button', { name: '切换视图', exact: true }).boundingBox();
    const week = await page.locator('.weeknav-label').boundingBox();
    const actions = await page.locator('.actions').boundingBox();
    assert.ok(menu && week && actions && menu.x >= 0 && menu.x + menu.width <= width);
    assert.ok(Math.abs(menu.y + menu.height / 2 - week.y - week.height / 2) < 4);
    assert.ok(Math.abs(menu.y + menu.height / 2 - actions.y - actions.height / 2) < 4);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await selectView('日程');
  await selectView('待办');
  await page.getByRole('button', { name: '新建待办', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill('玻璃面板点击验证');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.ok((await api('/api/state')).state.tasks.some((task: any) => task.title === '玻璃面板点击验证'));
});


test('玻璃下拉面板选中态、键盘切换、关闭与手机点击正常', async () => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(base);
  const trigger = page.getByRole('button', { name: '切换视图', exact: true });
  await trigger.click();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.getByRole('option', { name: '课表', exact: true }).getAttribute('aria-selected'), 'true');
  const box = await page.getByRole('listbox', { name: '日程视图' }).boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 320);
  await page.getByRole('option', { name: '待办', exact: true }).click();
  await page.locator('.todo-view').waitFor();
  assert.equal(await trigger.innerText(), '待办');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.equal(await trigger.innerText(), '日程');
  await trigger.click();
  assert.equal(await page.getByRole('option', { name: '日程', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
  await trigger.click();
  await page.getByRole('button', { name: '回到本周', exact: true }).click();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
});


test('切周按方向平滑滑入，快速切换和减少动态效果设置正常', async () => {
  await api('/api/term', { startDate: '2020-01-06', totalWeeks: 3 }, 'PUT');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(base);
  const grid = page.locator('.week-scroll');
  await grid.focus();
  await page.keyboard.press('ArrowLeft');
  const previous = await page.locator('.week-pages').evaluate(node => {
    const animation = node.getAnimations()[0];
    return animation ? animation.effect!.getKeyframes()[0].transform : null;
  });
  assert.match(String(previous), /translateX\(-/);
  await page.keyboard.press('ArrowRight');
  const next = await page.locator('.week-pages').evaluate(node => {
    const animation = node.getAnimations()[0];
    return animation ? { count: node.getAnimations().length, transform: animation.effect!.getKeyframes()[0].transform } : null;
  });
  assert.equal(next?.count, 1, '连续切换取消前一次动画');
  assert.match(String(next?.transform), /translateX\([0-9]/);
  await page.locator('.week-pages').evaluate(async node => { await Promise.all(node.getAnimations().map(a => a.finished.catch(() => {}))); });
  assert.equal(await page.locator('.week-pages').evaluate(node => getComputedStyle(node).transform), 'none');
  assert.ok(await grid.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('.week-pages').evaluate(node => node.getAnimations().length), 0);
  assert.match(await page.locator('.weeknav-label').innerText(), /第 2 周/);
});


test('课表跟随手指移动，短滑回弹、达标松手翻周、边界阻尼回弹', async () => {
  await api('/api/term', { startDate: '2020-01-06', totalWeeks: 3 }, 'PUT');
  await api('/api/courses', { title: '拖动不误打开的课程', weekday: 5, startTime: '08:00', endTime: '09:40' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.locator('.week-scroll').focus(); await page.keyboard.press('ArrowLeft'); await settleWeek();
  const client = await page.context().newCDPSession(page);
  const offset = () => page.locator('.week-pages').evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41);
  async function drag(dx: number) {
    const x = dx < 0 ? 270 : 90;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 230 }] });
    for (let i = 1; i <= 8; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 8, y: 230 }] });
  }
  async function release() { await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await settleWeek(); }
  try {
    await drag(-60);
    assert.ok(await offset() < -40, '松手前课表随手指向左移动');
    assert.match(await page.locator('.weeknav-label').innerText(), /第 2 周/, '松手前不切周');
    await release();
    assert.equal(await offset(), 0); assert.match(await page.locator('.weeknav-label').innerText(), /第 2 周/);
    await drag(-140);
    assert.ok(await offset() < -100); assert.match(await page.locator('.weeknav-label').innerText(), /第 2 周/);
    await release();
    assert.equal(await offset(), 0); assert.match(await page.locator('.weeknav-label').innerText(), /第 3 周/);
    await drag(-140);
    const resisted = await offset(); assert.ok(resisted < 0 && resisted > -60, '学期边界拖动有阻尼');
    await release(); assert.equal(await offset(), 0); assert.match(await page.locator('.weeknav-label').innerText(), /第 3 周/);
    await drag(70);
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await settleWeek();
    assert.equal(await offset(), 0, '手势取消后回到原位');
    assert.equal(await page.getByRole('dialog').count(), 0);
  } finally { await client.detach(); }
});


test('拖动时下一周紧贴当前周，显示真实安排，落位后不再二次滑入', async () => {
  await api('/api/term', { startDate: '2020-01-06', totalWeeks: 3 }, 'PUT');
  await api('/api/courses', { title: '当前第二周课程', weekday: 7, startTime: '08:00', endTime: '09:40', weeks: [2] });
  await api('/api/courses', { title: '下一周专属课程', weekday: 1, startTime: '08:00', endTime: '09:40', weeks: [3] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  const grid = page.locator('.week-scroll');
  await grid.focus(); await page.keyboard.press('ArrowLeft'); await settleWeek();
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 270, y: 430 }] });
    for (let i = 1; i <= 8; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 270 - 150 * i / 8, y: 430 }] });
    const current = page.locator('.week-inner'), preview = page.locator('.week-preview');
    assert.equal(await current.getAttribute('data-week'), '2');
    assert.equal(await preview.getAttribute('data-week'), '3');
    assert.match(await preview.innerText(), /下一周专属课程/);
    assert.doesNotMatch(await preview.innerText(), /当前第二周课程/);
    const a = await current.boundingBox(), b = await preview.boundingBox(), viewport = await grid.boundingBox();
    assert.ok(a && b && viewport && Math.abs(a.x + a.width - b.x) < 1, '两页边缘贴合没有空隙');
    assert.ok(b && viewport && b.x < viewport.x + viewport.width - 50, '拖动期间就能看到下一页');
    assert.equal(await preview.getAttribute('inert'), '');
    await page.screenshot({ path: 'docs/week-swipe-continuous.png' });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settleWeek();
    assert.equal(await current.getAttribute('data-week'), '3');
    assert.equal(await preview.count(), 0);
    assert.equal(await page.locator('.week-pages').evaluate(node => node.getAnimations().length), 0);
    assert.equal(await page.locator('.week-pages').evaluate(node => getComputedStyle(node).transform), 'none');
  } finally { await client.detach(); }
});


test('右滑时上一周节次栏始终贴在所属页面左侧，落位无瞬移', async () => {
  await api('/api/term', { startDate: '2020-01-06', totalWeeks: 3 }, 'PUT');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base); await page.locator('.week-inner').waitFor();
  const client = await page.context().newCDPSession(page);
  async function aligned() {
    const offsets = await page.evaluate(() => Array.from(document.querySelectorAll('.week-sheet')).flatMap(sheet => {
      const x = sheet.getBoundingClientRect().x;
      return ['.week-head-gutter', '.allday-label', '.time-gutter'].map(selector => ({
        page: sheet.className, selector, offset: sheet.querySelector(selector)!.getBoundingClientRect().x - x,
      }));
    }));
    for (const value of offsets) assert.ok(Math.abs(value.offset) < 1, `${value.page} ${value.selector} 偏移 ${value.offset}`);
  }
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 430 }] });
    for (let i = 1; i <= 8; i++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 90 + 150 * i / 8, y: 430 }] });
      if (i >= 2) await aligned();
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const track = page.locator('.week-pages');
    await track.evaluate(node => { const a = node.getAnimations()[0]; if (a) { a.pause(); a.currentTime = 130; } });
    await aligned();
    await track.evaluate(node => node.getAnimations().forEach(a => a.play()));
    await settleWeek(); await aligned();
    assert.equal(await page.locator('.week-inner').getAttribute('data-week'), '2');
  } finally { await client.detach(); }
});
