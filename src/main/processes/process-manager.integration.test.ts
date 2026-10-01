import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../logger';
import { ProcessManager, type ProcessManagerDeps } from './process-manager';

// Real child processes on every OS: the script name picks a node -e program instead of a package manager.
const PROGRAMS: Record<string, string> = {
  ok: 'console.log("all good")',
  crash: 'console.error("kaboom"); process.exit(2)',
  long: 'console.log("up"); setInterval(() => {}, 1000)',
};

const platform: ProcessManagerDeps['platform'] = {
  spawnScript: (opts) =>
    spawn(process.execPath, ['-e', PROGRAMS[opts.args[1] ?? ''] ?? ''], { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] }),
  killTree: async (pid) => {
    process.kill(pid);
  },
  resolveShellEnv: async () => ({ ...process.env }),
};

function manager() {
  return new ProcessManager({ platform, ledger: { add: () => {}, remove: () => {} }, bufferLines: () => 1_000, logger: createMemoryLogger() });
}

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const req = (script: string) => ({ projectId: 'p1', script, cwd: process.cwd(), packageManager: null, autoRestart: false });

describe('ProcessManager with real processes', () => {
  it('runs a script to a clean exit', async () => {
    const pm = manager();
    await pm.start(req('ok'));
    await until(() => pm.get('p1', 'ok')?.state === 'exited');
    expect(pm.logs('p1', 'ok').lines.map((l) => l.text)).toContain('all good');
  });

  it('reports a crash with its exit code and stderr', async () => {
    const pm = manager();
    await pm.start(req('crash'));
    await until(() => pm.get('p1', 'crash')?.state === 'crashed');
    expect(pm.get('p1', 'crash')?.exit).toEqual({ code: 2, signal: null, lastLine: 'kaboom' });
  });

  it('stops a long-running script', async () => {
    const pm = manager();
    await pm.start(req('long'));
    await until(() => pm.logs('p1', 'long').lines.some((l) => l.text === 'up'));
    expect((await pm.stop('p1', 'long')).state).toBe('stopped');
  });
});
