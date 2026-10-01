import { spawn } from 'node:child_process';
import type { CommandRunner } from './adapter';

export const spawnRunner: CommandRunner = {
  launch(file, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(file, [...args], {
        cwd: opts.cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        windowsVerbatimArguments: opts.verbatim ?? false,
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  },
};
