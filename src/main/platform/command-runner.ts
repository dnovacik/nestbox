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
      const child = spawn(file, [...args], {
        cwd: opts.cwd,
        env: opts.env,
        windowsHide: true,
        windowsVerbatimArguments: opts.verbatim ?? false,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
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
        // Something the program left running may hold stdout open long after the output we need.
        if (opts.doneWhen?.(stdout)) {
          finish(() => resolve({ code: child.exitCode, stdout }));
          child.stdout?.destroy();
        }
      });
      child.once('error', (error) => finish(() => reject(error)));
      child.once('close', (code) => finish(() => resolve({ code, stdout })));
    });
  },

  spawn(file, args, opts) {
    const child = spawn(file, [...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: [opts.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      // Never on Windows: there detached opens a console window. Only the darwin adapter asks for it.
      detached: opts.newProcessGroup ?? false,
      windowsHide: true,
      windowsVerbatimArguments: opts.verbatim ?? false,
    });
    if (opts.stdin !== undefined) {
      // A child that exits before reading everything closes the pipe: that's not our error to report.
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(opts.stdin);
    }
    return child;
  },
};
