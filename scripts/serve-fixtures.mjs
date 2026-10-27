// 本地静态文件服务，仅用于测试「教务系统链接导入」；正式使用可删。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'scripts/fixtures');

const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent((req.url ?? '/').split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
});

server.listen(8898, '127.0.0.1', () => console.log('fixtures on http://127.0.0.1:8898/jw.html'));
