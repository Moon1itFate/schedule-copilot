import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
let browser: Browser, context: BrowserContext, page: Page;
const origin = 'https://appassets.androidplatform.net';
const root = path.resolve('dist-mobile');
const errors: string[] = [];
const requests: string[] = [];
before(async () => { browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true }); });
beforeEach(async () => {
  await context?.close();
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, userAgent: 'Android WebView ScheduleCopilot/0.6 Standalone' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()); requests.push(url.href);
    assert.equal(url.origin, origin, '页面无需电脑地址或远程资源');
    assert.ok(!url.pathname.startsWith('/api/'), '本地数据接口不发出网络请求');
    const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
    assert.ok(file.startsWith(root) && existsSync(file));
    await route.fulfill({ body: readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html', headers: { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'" } });
  });
  await context.addInitScript(() => {
    (window as any).httpCalls = [];
    (window as any).exports = [];
    window.Phone = {
      read(key) { return localStorage.getItem(`native-${key}`) || ''; },
      write(key, value) { if (localStorage.getItem('fail-write')) return false; localStorage.setItem(`native-${key}`, value); return true; },
      exportFile(name, mime, text) { (window as any).exports.push({ name, mime, text }); },
      http(id, url, options) {
        const request = JSON.parse(options); (window as any).httpCalls.push({ url, ...request });
        const body = JSON.parse(request.body);
        const response = body.max_tokens ? { choices: [{ message: { content: 'pong' } }] }
          : body.messages.some((m: any) => m.role === 'tool') ? { choices: [{ message: { content: '已经添加到手机待办。' } }] }
          : { choices: [{ message: { content: '', tool_calls: [{ id: 'call-phone', type: 'function', function: { name: 'add_items', arguments: JSON.stringify({ items: [{ title: '联网AI创建的任务', due: '2099-10-29T12:00' }] }) } }] } }] };
        setTimeout(() => window.phoneHttpResult?.(id, JSON.stringify({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })), 5);
      },
    };
  });
  page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.locator('.week-inner').waitFor();
});
after(async () => { await browser?.close(); assert.deepEqual(errors, [], '离线页面无JS错误'); });
async function api(route: string, body?: any, method = 'POST') {
  return page.evaluate(async ({ route, body, method }) => {
    const response = await fetch(route, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  }, { route, body, method });
}
async function selectView(name: string) { await page.getByRole('button', { name: '切换视图', exact: true }).click(); await page.getByRole('option', { name, exact: true }).click(); }

test('断网仍可编辑课程、待办、作息，关闭重开数据保留', async () => {
  await context.setOffline(true);
  assert.equal(await page.evaluate(() => navigator.onLine), false);
  const course = await api('/api/courses', { title: '手机离线课程', weekday: 2, startTime: '08:00', endTime: '09:40' });
  assert.equal(course.status, 200);
  await page.reload(); await page.locator('.event-block').getByText('手机离线课程').click();
  await page.getByLabel('课程名', { exact: true }).fill('离线修改成功');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await selectView('待办');
  await page.getByRole('button', { name: '新建待办', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill('手机离线待办');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const state = (await api('/api/state')).state;
  const task = state.tasks[0];
  await api('/api/tasks', { id: task.id, done: true });
  await api('/api/term', { name: '手机离线学期' }, 'PUT');
  await page.close(); page = await context.newPage();
  await page.goto(origin); await page.locator('.week-inner').waitFor();
  const fresh = (await api('/api/state')).state;
  assert.equal(fresh.courses[0].title, '离线修改成功'); assert.equal(fresh.tasks[0].done, true); assert.equal(fresh.term.name, '手机离线学期');
  await api(`/api/tasks/${task.id}`, {}, 'DELETE');
  await api(`/api/courses/${course.course.id}`, {}, 'DELETE');
  assert.equal((await api('/api/state')).state.tasks.length, 0);
  assert.equal((await api('/api/state')).state.courses.length, 0);
});

test('手机设置保留接口，联网AI通过原生HTTP创建任务，离线不调用模型', async () => {
  await api('/api/settings', { baseUrl: 'https://model.example/v1', model: 'phone-model', apiKey: 'fake-test-key' }, 'PUT');
  await page.reload(); await page.locator('.week-inner').waitFor();
  assert.equal((await api('/api/settings/test', {})).ok, true);
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page.locator('.composer textarea').fill('帮我加一个任务');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText('已经添加到手机待办。', { exact: true }).waitFor();
  assert.equal((await api('/api/state')).state.tasks[0].title, '联网AI创建的任务');
  const count = await page.evaluate(() => (window as any).httpCalls.length);
  assert.equal(count, 3);
  await context.setOffline(true);
  await page.locator('.composer textarea').fill('断网再问一次');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByText(/当前离线，AI 请联网后使用/).waitFor();
  assert.equal(await page.evaluate(() => (window as any).httpCalls.length), count);
});

test('离线备份恢复、ICS导入导出与本地规则解析可用', async () => {
  await context.setOffline(true);
  await api('/api/settings', { localMode: true }, 'PUT');
  const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:phone-ics\r\nDTSTART:20991029T190000\r\nDTEND:20991029T210000\r\nSUMMARY:离线导入考试\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const result = await api('/api/import', { mode: 'ics', text });
  assert.equal(result.tasks.length, 1);
  await api('/api/import', { mode: 'ics', commit: true, courses: [], tasks: result.tasks });
  await page.reload(); await page.locator('.week-inner').waitFor();
  await page.locator('.topbar').getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '导出完整备份', exact: true }).click();
  await page.getByRole('link', { name: '导出 ICS', exact: true }).click();
  const files = await page.evaluate(() => (window as any).exports);
  assert.equal(JSON.parse(files[0].text).state.tasks[0].title, '离线导入考试');
  assert.ok(!files[0].text.includes('apiKey'));
  assert.match(files[1].text, /BEGIN:VCALENDAR/);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await api('/api/data/reset', { demo: false }); await page.reload(); await page.locator('.week-inner').waitFor();
  page.on('dialog', d => d.accept());
  await page.locator('.topbar').getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(files[0].text) });
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await api('/api/state')).state.tasks[0].title, '离线导入考试');
  await page.getByRole('button', { name: '对话', exact: true }).click();
  await page.locator('.composer textarea').fill('明天下午三点前交高数作业');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('native-state')!).tasks.length === 2);
});

test('存储失败明确报错，原有数据不被覆盖', async () => {
  await api('/api/tasks', { title: '已有任务' });
  await page.evaluate(() => localStorage.setItem('fail-write', '1'));
  const response = await api('/api/tasks', { title: '不能保存的任务' });
  assert.equal(response.status, 400); assert.match(response.error, /存储失败/);
  assert.equal((await api('/api/state')).state.tasks.length, 1);
});
