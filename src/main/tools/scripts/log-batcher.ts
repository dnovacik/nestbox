import type { LogLine } from '@shared/processes';

export interface LogBatcher {
  add(projectId: string, script: string, line: LogLine): void;
  flushNow(): void;
  dispose(): void;
}

/** Collects lines per (project, script) and hands them over at most every `intervalMs`. */
export function createLogBatcher(opts: {
  intervalMs: number;
  flush(projectId: string, script: string, lines: LogLine[]): void;
}): LogBatcher {
  const pending = new Map<string, { projectId: string; script: string; lines: LogLine[] }>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flushNow = (): void => {
    clearTimeout(timer);
    timer = undefined;
    const batches = [...pending.values()];
    pending.clear();
    for (const b of batches) opts.flush(b.projectId, b.script, b.lines);
  };

  return {
    add(projectId, script, line) {
      const key = JSON.stringify([projectId, script]);
      const batch = pending.get(key) ?? { projectId, script, lines: [] };
      batch.lines.push(line);
      pending.set(key, batch);
      timer ??= setTimeout(flushNow, opts.intervalMs);
    },
    flushNow,
    dispose() {
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}
