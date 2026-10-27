import type { AppState, ChatMessage, Course, SettingsView, Task } from './types';

export interface StatePayload {
  state: AppState;
  settings: SettingsView;
  week: number;
  today: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!response.ok) throw new Error(data?.error || `请求失败（${response.status}）`);
  return data as T;
}

export const api = {
  state: () => request<StatePayload>('/api/state'),

  saveTerm: (patch: Record<string, unknown>) =>
    request<{ state: AppState }>('/api/term', { method: 'PUT', body: JSON.stringify(patch) }),

  saveTask: (task: Partial<Task>) =>
    request<{ state: AppState; task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(task) }),

  deleteTask: (id: string) => request<{ state: AppState }>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  saveCourse: (course: Partial<Course>) =>
    request<{ state: AppState; course: Course }>('/api/courses', { method: 'POST', body: JSON.stringify(course) }),

  deleteCourse: (id: string) => request<{ state: AppState }>(`/api/courses/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  saveSettings: (patch: Record<string, unknown>) =>
    request<SettingsView & { ok: boolean }>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  testConnection: (patch: Record<string, unknown>) =>
    request<{ ok: boolean; message: string }>('/api/settings/test', { method: 'POST', body: JSON.stringify(patch) }),

  reset: (demo: boolean) =>
    request<{ state: AppState }>('/api/data/reset', { method: 'POST', body: JSON.stringify({ demo }) }),

  addresses: () =>
    request<{ addresses: { url: string; iface: string }[]; port: number }>('/api/addresses'),

  importSchedule: (payload: Record<string, unknown>) =>
    request<{
      courses: Course[];
      notes: string[];
      termStart?: string;
      taskCount: number;
      tasks: Task[];
      state?: AppState;
    }>('/api/import', { method: 'POST', body: JSON.stringify(payload) }),
};

export async function chatStream(
  messages: ChatMessage[],
  handlers: {
    onText: (value: string) => void;
    onState: (state: AppState) => void;
    onError: (value: string) => void;
  },
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch (error) {
    handlers.onError(error instanceof Error ? error.message : String(error));
    return;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    handlers.onError(text || `请求失败（${response.status}）`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleEvent = (raw: string) => {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (event.type === 'text') handlers.onText(event.value);
    else if (event.type === 'state') handlers.onState(event.state);
    else if (event.type === 'error') handlers.onError(event.value);
  };

  const handleLine = (line: string) => {
    if (line.startsWith('data:')) {
      const raw = line.slice(5).trim();
      if (raw) handleEvent(raw);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        handleLine(buffer.slice(0, index).replace(/\r$/, ''));
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
      if (done) { if (buffer.trim()) handleLine(buffer.trim()); break; }
    }
  } catch (error) {
    handlers.onError(error instanceof Error ? error.message : String(error));
  } finally {
    reader.releaseLock();
  }
}
