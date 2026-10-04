// Runs a package manager command to completion for the dependency check: the login-shell env (so the
// user's registry config and PATH apply), no colours, a 2-minute timeout and capped output.
import type { PlatformAdapter } from '../../platform/adapter';
import type { Run } from './check';

export const COMMAND_TIMEOUT_MS = 120_000;
const MAX_STDOUT = 8 * 1024 * 1024;

export function createRun(
  platform: Pick<PlatformAdapter, 'spawnCommand' | 'resolveShellEnv' | 'killTree'>,
  cwd: string,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Run {
  return async (command, args) => {
    const env = { ...(await platform.resolveShellEnv()), NO_COLOR: '1', FORCE_COLOR: '0' };
    let child;
    try {
      child = platform.spawnCommand({ cwd, command, args, env });
    } catch {
      return { code: null, stdout: '', timedOut: false };
    }
    return new Promise((resolve) => {
      let stdout = '';
      let done = false;
      let timedOut = false;
      const finish = (code: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ code, stdout, timedOut });
      };
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_STDOUT) stdout += chunk.toString('utf8');
      });
      // stderr holds progress and registry errors: drained, never kept or logged.
      child.stderr?.resume();
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) void platform.killTree(child.pid).catch(() => undefined);
        finish(null);
      }, timeoutMs);
      child.once('error', () => finish(null));
      child.once('close', (code: number | null) => finish(code));
    });
  };
}
