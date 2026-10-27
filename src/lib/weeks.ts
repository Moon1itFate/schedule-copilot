export function formatWeeks(weeks: number[]): string {
  if (!weeks.length) return '';
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = current;
    prev = current;
  }
  return runs.join(',');
}

export function parseWeeks(text: string, total = 30): number[] {
  const normalized = text
    .replace(/[－—–~～]/g, '-')
    .replace(/，/g, ',')
    .replace(/[、;；]/g, ',')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/[第周()]/g, '')
    .replace(/\s+/g, '');
  const parity = normalized.includes('单') && !normalized.includes('双') ? '单'
    : normalized.includes('双') && !normalized.includes('单') ? '双' : '';
  const weeks = new Set<number>();
  const parts = normalized ? normalized.split(',').filter(Boolean) : [`1-${total}`];
  for (const part of parts) {
    const match = part.match(/^(\d+)(?:-(\d+))?([单双])?$/);
    if (!match && !/^[单双]$/.test(part)) return [];
    const mode = match?.[3] ?? (/^[单双]$/.test(part) ? part : parity);
    const from = match ? Number(match[1]) : 1;
    const to = match ? Number(match[2] ?? match[1]) : total;
    for (let w = Math.max(1, Math.min(from, to)); w <= Math.min(total, Math.max(from, to)); w++) {
      if (mode === '单' && w % 2 === 0) continue;
      if (mode === '双' && w % 2 === 1) continue;
      weeks.add(w);
    }
  }
  return [...weeks].sort((a, b) => a - b);
}
