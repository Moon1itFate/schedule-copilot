import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e)}`));
page.on('response', async (r) => {
  if (r.url().includes('/api/import')) logs.push(`[http ${r.status()}] ${r.url()} ${(await r.text().catch(() => '')).slice(0, 200)}`);
});

await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

console.log('buttons:', await page.locator('.actions .btn').allInnerTexts());
await page.locator('.actions .btn').first().click();
await page.waitForTimeout(800);
console.log('modals after click:', await page.locator('.modal').count());
console.log('modal title:', await page.locator('.modal-head h2').innerText().catch(() => 'none'));
await page.screenshot({ path: 'docs/check-import-open.png' });

const ta = page.locator('.import textarea').first();
if (await ta.count()) {
  await ta.fill('高等数学 周一 1-2节 1-16周 教三201\n数据结构 周四 5-6节 1-16周 计算机楼402');
  await page.getByRole('button', { name: '解析预览' }).click();
  await page.waitForTimeout(2000);
  console.log('preview rows:', await page.locator('.preview-row').count());
  console.log('notes:', await page.locator('.notes').innerText().catch(() => 'none'));
  await page.screenshot({ path: 'docs/check-import-preview.png' });
}

console.log('LOGS:\n' + logs.join('\n'));
await browser.close();
