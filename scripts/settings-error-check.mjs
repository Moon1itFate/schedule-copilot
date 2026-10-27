import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
await page.locator('.topbar .actions .icon-btn').click();
await page.waitForTimeout(500);

await page.locator('input[type="password"]').fill('sk-invalid-test-key');
await page.getByRole('button', { name: '测试连接' }).click();
await page.waitForTimeout(2500);
const note = await page.locator('.form-note').first().innerText().catch(() => 'none');
console.log('NOTE:', note.replace(/\s+/g, ' ').slice(0, 200));
await page.screenshot({ path: 'docs/shot-settings-error.png' });
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
