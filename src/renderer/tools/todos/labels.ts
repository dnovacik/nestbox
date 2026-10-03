import type { Todo } from '@shared/tools/todos/contract';

/** FIXME/BUG red, HACK/XXX amber, anything else the accent. */
export function tagTone(tag: string): string {
  if (tag === 'FIXME' || tag === 'BUG') return 'border-err/40 text-err';
  if (tag === 'HACK' || tag === 'XXX') return 'border-warn/40 text-warn';
  return 'border-brand/40 text-brand';
}

/** Count per tag, most first, then by name. */
export function tagCounts(todos: readonly Todo[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const t of todos) counts.set(t.tag, (counts.get(t.tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const TRUNCATED_TEXT = {
  files: 'Stopped at 20,000 files.',
  matches: 'Stopped at 5,000 TODOs.',
  time: 'Stopped after 30 s.',
} as const;
