import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AppState, Course, Period, Task, Term } from '../src/types.js';

export interface Settings {
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  /** 本地离线模式：不调用模型，用规则解析 */
  localMode?: boolean;
}

const DATA_DIR = process.env.SCHEDULE_DATA_DIR
  ? path.resolve(process.env.SCHEDULE_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export { DEFAULT_PERIODS, DEFAULT_SETTINGS } from './defaults.js';
import { DEFAULT_SETTINGS, defaultState } from './defaults.js';

let stateCache: AppState | null = null;
let settingsCache: Settings | null = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown) {
  ensureDir();
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function getState(): AppState {
  if (stateCache) return stateCache;
  const existing = readJson<AppState>(STATE_FILE);
  if (existing && existing.term && Array.isArray(existing.courses) && Array.isArray(existing.tasks)) {
    stateCache = existing;
    return stateCache;
  }
  stateCache = defaultState(true);
  writeJson(STATE_FILE, stateCache);
  return stateCache;
}

export function saveState(next: AppState) {
  writeJson(STATE_FILE, next);
  stateCache = next;
}

export function getSettings(): Settings {
  if (settingsCache) return settingsCache;
  const existing = readJson<Partial<Settings>>(SETTINGS_FILE);
  settingsCache = { ...DEFAULT_SETTINGS, ...(existing ?? {}) };
  return settingsCache;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  if (!next.apiKey) next.apiKey = '';
  writeJson(SETTINGS_FILE, next);
  settingsCache = next;
  return next;
}

export function publicSettings() {
  const s = getSettings();
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(s.baseUrl);
  return {
    baseUrl: s.baseUrl,
    model: s.model,
    apiKeySet: Boolean(s.apiKey) || isLocal || Boolean(s.localMode),
    temperature: s.temperature,
    localMode: Boolean(s.localMode),
  };
}

export function resetData(seedDemo: boolean) {
  saveState(defaultState(seedDemo));
  return getState();
}

export function newId() {
  return crypto.randomUUID();
}

export function dataDir() {
  return DATA_DIR;
}
