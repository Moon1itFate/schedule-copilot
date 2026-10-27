import type { AppState } from '../types';
import type { Settings } from '../../server/store';
import { defaultState, DEFAULT_SETTINGS } from '../../server/defaults';
export { DEFAULT_PERIODS, DEFAULT_SETTINGS } from '../../server/defaults';
export interface PhoneBridge {
  read(key: string): string;
  write(key: string, value: string): boolean;
  http(id: string, url: string, options: string): void;
  exportFile(name: string, mime: string, text: string): void;
}
declare global {
  interface Window { Phone?: PhoneBridge; phoneHttpResult?: (id: string, result: string) => void; }
}
function read<T>(key: string): T | null {
  const raw = window.Phone ? window.Phone.read(key) : localStorage.getItem(`phone-${key}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { throw new Error('手机数据读取失败，请先恢复备份，避免覆盖原有数据。'); }
}
function write(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  if (window.Phone) {
    if (!window.Phone.write(key, raw)) throw new Error('手机存储失败，请检查剩余空间后重试。');
  } else localStorage.setItem(`phone-${key}`, raw);
}
export function getState(): AppState {
  let state = read<AppState>('state');
  if (!state) { state = defaultState(false); write('state', state); }
  return state;
}
export function saveState(state: AppState) { write('state', state); }
export function getSettings(): Settings { return { ...DEFAULT_SETTINGS, ...read<Settings>('settings') }; }
export function saveSettings(patch: Partial<Settings>) {
  const next = { ...getSettings(), ...patch }; write('settings', next); return next;
}
export function publicSettings() {
  const { apiKey, ...settings } = getSettings();
  return { ...settings, localMode: Boolean(settings.localMode), apiKeySet: Boolean(apiKey || settings.localMode || /localhost|127\.0\.0\.1/.test(settings.baseUrl)) };
}
export function resetData(demo: boolean) { const state = defaultState(demo); saveState(state); return state; }
export function newId() { return crypto.randomUUID(); }
