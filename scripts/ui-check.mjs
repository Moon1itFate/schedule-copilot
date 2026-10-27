import { chromium } from 'playwright-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));

await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
fs.mkdirSync('docs', { recursive: true });
await page.screenshot({ path: 'docs/check-week.png' });

// 导入：粘贴文本 -> 解析预览（无 Key 时应走规则解析）
await page.locator('.actions .btn').first().click();
await page.waitForTimeout(400);
await page.locator('.import textarea').first().fill(
  '高等数学 周一 1-2节 1-16周 教三201\n数据结构 周四 5-6节 1-16周 计算机楼402\n大学英语 周二 3-4节 1-16周 外语楼305',
);
await page.getByRole('button', { name: '解析预览' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'docs/shot-import.png' });
const previewCount = await page.locator('.preview-row').count();
console.log('PREVIEW ROWS:', previewCount, '| NOTES:', await page.locator('.notes').innerText().catch(() => 'none'));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 无 Key 时聊天应给出可读错误
await page.locator('.composer textarea').fill('明天交高数作业');
await page.locator('.send-btn').click();
await page.waitForTimeout(1500);
const reply = await page.locator('.msg-assistant .bubble').last().innerText().catch(() => 'none');
console.log('NO-KEY REPLY:', reply.replace(/\s+/g, ' ').slice(0, 160));
await page.screenshot({ path: 'docs/check-no-key.png' });

// 设置里的「手机访问」地址
await page.locator('.topbar .actions .icon-btn').click();
await page.waitForTimeout(700);
await page.screenshot({ path: 'docs/shot-settings.png' });
const addrs = await page.locator('.addr-row code').allInnerTexts().catch(() => []);
console.log('LAN ADDRESSES:', addrs.join(' | ') || 'none');
await page.keyboard.press('Escape');

console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
