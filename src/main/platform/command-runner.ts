import { spawn } from 'node:child_process';
import type { CommandRunner, ExecResult } from './adapter';

const STDOUT_CAP = 65_536;
const DEFAULT_EXEC_TIMEOUT_MS = 10_000;

export const spawnRunner: CommandRunner = {
  launch(file, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(file, [...args], {
        cwd: opts.cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: opts.hidden ?? false,
        windowsVerbatimArguments: opts.verbatim ?? false,
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  },

  exec(file, args, opts = {}) {
    return new Promise<ExecResult>((resolve, reject) => {
      const child = spawn(file, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      let settled = false;
      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        settle();
      };
      const timer = setTimeout(() => {
        finish(() => resolve({ code: null, stdout }));
        child.kill();
      }, opts.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS);
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        const cap = opts.maxBytes ?? STDOUT_CAP;
        if (stdout.length < cap) stdout = (stdout + chunk).slice(0, cap);
      });
      child.once('error', (error) => finish(() => reject(error)));
      child.once('close', (code) => finish(() => resolve({ code, stdout })));
    });
  },

  spawn(file, args, opts) {
    return spawn(file, [...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: opts.verbatim ?? false,
    });
  },
};
