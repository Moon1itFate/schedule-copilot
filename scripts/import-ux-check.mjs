import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

// 1) 360px 顶栏是否都在屏内
const page = await browser.newPage({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const boxes = [];
for (const el of await page.locator('.topbar button, .topbar a.btn').all()) {
  if (!(await el.isVisible())) continue;
  const b = await el.boundingBox();
  boxes.push({ label: (await el.innerText()).trim() || (await el.getAttribute('aria-label')) || '?', right: Math.round(b.x + b.width) });
}
console.log('TOPBAR:', boxes.map((b) => `${b.label}@${b.right}`).join(' | '), '| viewport 360');

// 2) 打开导入，测试无结果提示
await page.locator('.actions .btn').first().click();
await page.waitForTimeout(600);
await page.locator('.import textarea').first().fill('随便粘一些认不出来的内容');
await page.getByRole('button', { name: '解析预览' }).click();
await page.waitForTimeout(1200);
console.log('EMPTY BANNER:', await page.locator('.form-error').first().innerText().catch(() => 'none'));
console.log('FOOTER BUTTON:', await page.locator('.modal-foot .btn-primary').innerText().catch(() => 'none'));
await page.screenshot({ path: 'docs/check-import-empty.png' });

// 3) 填入示例 -> 解析
await page.getByRole('button', { name: '填入示例' }).click();
await page.waitForTimeout(400);
console.log('TEXTAREA:', (await page.locator('.import textarea').first().inputValue()).slice(0, 40));
await page.getByRole('button', { name: '解析预览' }).click();
await page.waitForTimeout(1500);
console.log('EXAMPLE ROWS:', await page.locator('.preview-row').count());
await page.screenshot({ path: 'docs/check-import-example.png' });

await browser.close();
