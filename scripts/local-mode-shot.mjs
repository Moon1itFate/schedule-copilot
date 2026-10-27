import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

for (const text of ['明天下午三点前交高数作业', '下周三晚上七点蓝桥杯模拟赛']) {
  await page.locator('.composer textarea').fill(text);
  await page.locator('.send-btn').click();
  await page.waitForTimeout(1200);
}

await page.screenshot({ path: 'docs/shot-local-mode.png' });
console.log('LAST REPLY:', (await page.locator('.msg-assistant .bubble').last().innerText()).replace(/\s+/g, ' '));
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
