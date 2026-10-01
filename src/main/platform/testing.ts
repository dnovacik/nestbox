// Test helpers for platform code. Never imported by production modules.
import type { CommandRunner, ExecResult } from './adapter';

/** A runner whose every method succeeds and does nothing. */
export const noopRunner: CommandRunner = {
  launch: async () => {},
  exec: async () => ({ code: 0, stdout: '' }),
  spawn: () => {
    throw new Error('spawn is not expected in this test');
  },
};

export interface ExecCall {
  file: string;
  args: readonly string[];
}

/** exec results by file name; an Error rejects (as when the program cannot start). Default: exit 0. */
export type ExecScript = Record<string, ExecResult | Error | ((args: readonly string[]) => ExecResult | Error)>;

export function scriptedExec(script: ExecScript = {}) {
  const calls: ExecCall[] = [];
  const exec = async (file: string, args: readonly string[]): Promise<ExecResult> => {
    calls.push({ file, args });
    const entry = script[file];
    const result = typeof entry === 'function' ? entry(args) : entry;
    if (result instanceof Error) throw result;
    return result ?? { code: 0, stdout: '' };
  };
  return { calls, exec };
}
