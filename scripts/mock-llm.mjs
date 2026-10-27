// 仅用于本地验证对话链路：模拟一个 OpenAI 兼容接口，第一次返回工具调用，第二次返回文本。
import http from 'node:http';

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404).end('not found');
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  let payload = {};
  try {
    payload = JSON.parse(body || '{}');
  } catch {
    /* ignore */
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const hasToolResult = messages.some((message) => message.role === 'tool');

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  if (!hasToolResult) {
    send({ choices: [{ delta: { content: '好，我记下了这两件事。' } }] });
    const args = JSON.stringify({
      items: [
        { title: '高数作业：第 4 章', kind: 'task', due: '2026-10-28T22:00', course: '高等数学 A' },
        { title: '蓝桥杯模拟赛', kind: 'contest', due: '2026-10-30T19:00', location: '线上' },
      ],
    });
    send({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_mock_1', type: 'function', function: { name: 'add_items', arguments: args } },
            ],
          },
        },
      ],
    });
    send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
  } else {
    send({ choices: [{ delta: { content: '已经加好了，周三和周五各一条。' } }] });
    send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
  }
  res.write('data: [DONE]\n\n');
  res.end();
});

server.listen(8899, '127.0.0.1', () => {
  console.log('mock LLM ready on http://127.0.0.1:8899/v1');
});
