// 测试 ICS 导出 -> 重新导入 的闭环
import fs from 'node:fs';

const base = 'http://127.0.0.1:8787';

const ics = await (await fetch(`${base}/api/export.ics`)).text();
fs.writeFileSync('scripts/roundtrip.ics', ics, 'utf8');
console.log('exported bytes:', ics.length, 'events:', (ics.match(/BEGIN:VEVENT/g) || []).length);

const preview = await (
  await fetch(`${base}/api/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'ics', text: ics, termStart: '2026-09-14' }),
  })
).json();

console.log('notes:', preview.notes);
for (const course of preview.courses ?? []) {
  console.log(`course ${course.title} 周${course.weekday} ${course.startTime}-${course.endTime} weeks=${course.weeks.length} @${course.location ?? ''}`);
}
console.log('taskCount:', preview.taskCount);
