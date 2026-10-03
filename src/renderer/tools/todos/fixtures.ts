import type { Todo, TodoScan } from '@shared/tools/todos/contract';

export const todo = (path: string, line: number, tag: string, text: string, owner: string | null = null): Todo => ({ path, line, tag, text, owner });

/** A finished git scan, for renderer tests. */
export function todoScan(todos: Todo[], patch: Partial<TodoScan> = {}): TodoScan {
  return { scannedAt: Date.now() - 5 * 60_000, source: 'git', files: 42, todos, truncated: null, durationMs: 120, ...patch };
}
