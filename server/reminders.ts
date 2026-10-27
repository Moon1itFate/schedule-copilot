import type { AppState } from '../src/types.js';
import { normalizeDate, parseLocal } from './util.js';

/** Small, key-free feed for the phone's local alarm cache. */
export function reminderFeed(state: AppState, now = Date.now()) {
  const items = state.tasks.flatMap((task) => {
    if (task.done) return [];
    const date = normalizeDate(task.start || task.due);
    if (!date) return [];
    const at = parseLocal(task.allDay || date.length === 10 ? `${date.slice(0, 10)}T09:00` : date).getTime();
    if (!Number.isFinite(at) || at <= now) return [];
    return [{ id: task.id, title: task.title, at, kind: task.kind, location: task.location ?? '' }];
  }).sort((a, b) => a.at - b.at).slice(0, 100);
  return { generatedAt: now, items };
}
