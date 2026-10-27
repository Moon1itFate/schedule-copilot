import type { AppState, ChatMessage } from '../src/types.js';
import type { Settings } from './store.js';
import { buildSystemPrompt, TOOLS } from './prompt.js';
import { executeTool } from './tools.js';
import { getState } from './store.js';

export type AgentEvent =
  | { type: 'text'; value: string }
  | { type: 'state'; state: AppState }
  | { type: 'done' }
  | { type: 'error'; value: string };

interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface Completion {
  content: string;
  toolCalls: ToolCall[];
}

type WireMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function endpoint(baseUrl: string): string {
  const clean = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (/\/chat\/completions$/.test(clean)) return clean;
  return `${clean}/chat/completions`;
}

function friendlyError(status: number, body: string): string {
  const snippet = body.slice(0, 300);
  if (status === 401 || status === 403) return `模型鉴权失败（${status}）。请到设置里检查 API Key 是否正确。`;
  if (status === 404) return `接口地址不对（404）。Base URL 应形如 https://api.deepseek.com/v1，而不是完整的 /chat/completions 之前的其它路径。`;
  if (status === 429) return `模型服务限流或余额不足（429）。稍后再试，或检查账户余额。`;
  return `模型服务返回 ${status}：${snippet}`;
}

async function streamCompletion(
  settings: Settings,
  messages: WireMessage[],
  onText: (delta: string) => void,
): Promise<Completion> {
  const url = endpoint(settings.baseUrl);
  if (!url) throw new Error('还没有配置模型接口地址，请点右上角「设置」填写 Base URL、模型名和 API Key。');
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(settings.baseUrl);
  if (!settings.apiKey && !isLocal) throw new Error('还没有配置 API Key，请点右上角「设置」填写。');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        stream: true,
        temperature: typeof settings.temperature === 'number' ? settings.temperature : 0.3,
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`连不上模型服务：${message}。检查网络、Base URL，或代理是否正常。`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(friendlyError(response.status, body));
  }

  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const json: any = await response.json();
    const choice = json?.choices?.[0]?.message ?? {};
    const content = typeof choice.content === 'string' ? choice.content : '';
    if (content) onText(content);
    const toolCalls: ToolCall[] = (choice.tool_calls ?? []).map((call: any, index: number) => ({
      id: call.id ?? `call_${index}`,
      name: call.function?.name ?? '',
      arguments: call.function?.arguments ?? '{}',
    }));
    return { content, toolCalls: toolCalls.filter((c) => c.name) };
  }

  if (!response.body) throw new Error('模型服务没有返回内容流。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const slots: Record<number, { id?: string; name?: string; arguments?: string }> = {};

  const handleData = (payload: string) => {
    if (!payload || payload === '[DONE]') return;
    let json: any;
    try {
      json = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = json?.choices?.[0]?.delta;
    if (!delta) return;
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content;
      onText(delta.content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) {
        const index = Number(call.index ?? 0);
        const slot = (slots[index] ??= {});
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name = (slot.name ?? '') + call.function.name;
        if (call.function?.arguments) slot.arguments = (slot.arguments ?? '') + call.function.arguments;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line.startsWith('data:')) handleData(line.slice(5).trim());
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.startsWith('data:')) handleData(buffer.slice(5).trim());

  const toolCalls: ToolCall[] = Object.keys(slots)
    .map(Number)
    .sort((a, b) => a - b)
    .map((index) => {
      const slot = slots[index];
      return { id: slot.id ?? `call_${index}`, name: slot.name ?? '', arguments: slot.arguments ?? '{}' };
    })
    .filter((call) => call.name);

  return { content, toolCalls };
}

export async function runAgent(options: {
  history: ChatMessage[];
  state: AppState;
  settings: Settings;
  emit: (event: AgentEvent) => void;
}): Promise<void> {
  const { state, settings, emit } = options;
  const history = options.history.slice(-24).filter((m) => m.content?.trim());
  const messages: WireMessage[] = [
    { role: 'system', content: buildSystemPrompt(state) },
    ...history.map((m) => ({ role: m.role, content: m.content }) as WireMessage),
  ];

  try {
    for (let round = 0; round < 5; round++) {
      const completion = await streamCompletion(settings, messages, (delta) => emit({ type: 'text', value: delta }));

      if (!completion.toolCalls.length) {
        emit({ type: 'done' });
        return;
      }

      messages.push({
        role: 'assistant',
        content: completion.content || '',
        tool_calls: completion.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      });

      let changed = false;
      for (const call of completion.toolCalls) {
        const result = executeTool(call.name, call.arguments, getState());
        if (result.changed) changed = true;
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.text });
      }
      if (changed) emit({ type: 'state', state: getState() });
    }
    emit({ type: 'done' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: 'error', value: message });
  }
}
