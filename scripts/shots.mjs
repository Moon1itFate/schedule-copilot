import { chromium } from 'playwright-core';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
fs.mkdirSync('docs', { recursive: true });

const errors = [];

// desktop
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
page.on('response', async (response) => {
  if (response.status() >= 400) {
    let body = '';
    try {
      body = (await response.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    errors.push(`http ${response.status()} ${response.url()} ${body}`);
  }
});
await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: 'docs/shot-week.png' });

await page.locator('.tabs button').nth(1).click();
await page.waitForTimeout(450);
await page.screenshot({ path: 'docs/shot-agenda.png' });

await page.locator('.tabs button').nth(2).click();
await page.waitForTimeout(450);
await page.screenshot({ path: 'docs/shot-todo.png' });
await page.locator('.tabs button').nth(0).click();

await page.locator('.actions .btn').first().click();
await page.waitForTimeout(400);
await page.locator('.import textarea').first().fill(
  '高等数学 周一 1-2节 1-16周 教三201\n数据结构 周四 5-6节 1-16周 计算机楼402\n大学英语 周二 3-4节 1-16周 外语楼305',
);
await page.getByRole('button', { name: '解析预览' }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: 'docs/shot-import.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
mobile.on('pageerror', (e) => errors.push(`mobile pageerror: ${String(e)}`));
await mobile.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
await mobile.waitForTimeout(700);
await mobile.screenshot({ path: 'docs/shot-mobile.png' });
await mobile.locator('.chat-toggle').click();
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: 'docs/shot-mobile-chat.png' });

console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
