import { chromium } from 'playwright-core';

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

for (const width of [390, 360, 320]) {
  const page = await browser.newPage({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true });
  await page.goto('http://127.0.0.1:8787/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const boxes = [];
  for (const el of await page.locator('.topbar button, .topbar a.btn').all()) {
    boxes.push({ text: (await el.innerText()).trim() || (await el.getAttribute('aria-label')) || '?', box: await el.boundingBox() });
  }
  console.log(`--- width ${width} ---`);
  for (const b of boxes) {
    const right = b.box ? Math.round(b.box.x + b.box.width) : -1;
    console.log(`${b.text}: x=${Math.round(b.box?.x ?? -1)} right=${right} visible=${right <= width}`);
  }
  await page.screenshot({ path: `docs/check-topbar-${width}.png` });
  await page.close();
}
await browser.close();
