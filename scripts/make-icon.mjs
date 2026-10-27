import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/app-icon.svg'), 'utf8');
const chrome = [process.env.SCHEDULE_BROWSER_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
const browser = await chromium.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(svg, size, output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path: output, omitBackground: true });
  }
  for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    await render(source, size, path.join(root, `android/res/mipmap-${density}/ic_launcher.png`));
  }
  await render(source, 512, path.join(root, 'docs/app-icon.png'));
  const foreground = source.replace(/<g id="icon-background">[\s\S]*?<\/g>/, '');
  await render(foreground, 432, path.join(root, 'android/res/drawable-nodpi/ic_launcher_foreground.png'));
  console.log('Rendered warm glass launcher icons, adaptive foreground, and docs/app-icon.png');
} finally { await browser.close(); }
