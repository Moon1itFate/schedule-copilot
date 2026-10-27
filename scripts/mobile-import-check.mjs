import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e)}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[console] ${m.text()}`); });

await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.screenshot({ path: 'docs/check-mobile-home.png' });

// 点顶部第一个按钮（导入课表，移动端只剩图标）
const buttons = page.locator('.actions .btn');
console.log('action buttons:', await buttons.count());
await buttons.first().click();
await page.waitForTimeout(800);
console.log('modals:', await page.locator('.modal').count());
console.log('title:', await page.locator('.modal-head h2').innerText().catch(() => 'none'));
const footer = page.locator('.modal-foot');
console.log('footer visible:', await footer.isVisible().catch(() => false));
console.log('footer box:', await footer.boundingBox().catch(() => null));
await page.screenshot({ path: 'docs/check-mobile-import.png' });
console.log('LOGS:', logs.length ? logs : 'none');
await browser.close();
