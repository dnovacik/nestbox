import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnRunner } from './command-runner';
import { createWin32Adapter } from './win32';

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitUntil(check: () => boolean, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.runIf(process.platform === 'win32')('win32 process control (integration)', () => {
  const adapter = createWin32Adapter({ runner: spawnRunner, getEditorCommand: () => 'code' });
  const dir = mkdtempSync(join(tmpdir(), 'nestbox-tree-'));
  // A process still using the folder as its cwd keeps it locked for a moment after it is killed.
  afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

  it('spawns through cmd.exe, reads the start time and kills the process', async () => {
    const child = adapter.spawnScript({
      cwd: dir,
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      env: process.env,
    });
    await new Promise((r) => child.once('spawn', r));
    const spawnedAt = Date.now();
    const pid = child.pid ?? 0;
    try {
      // A cold PowerShell on a CI runner can take over 10 s.
      const started = await adapter.processStartTime(pid);
      expect(started).not.toBeNull();
      expect(Math.abs((started ?? 0) - spawnedAt)).toBeLessThan(3_000);
    } finally {
      await adapter.killTree(pid);
    }
    await waitUntil(() => !isAlive(pid));
  }, 60_000);

  it('kills grandchildren too', async () => {
    writeFileSync(join(dir, 'leaf.js'), 'console.log(process.pid); setInterval(() => {}, 1000);');
    writeFileSync(
      join(dir, 'tree.js'),
      "require('child_process').spawn(process.execPath, [require('path').join(__dirname, 'leaf.js')], { stdio: 'inherit' }); setInterval(() => {}, 1000);",
    );
    const child = adapter.spawnScript({ cwd: dir, command: process.execPath, args: ['tree.js'], env: process.env });
    const leafPid = await new Promise<number>((resolve) => {
      child.stdout?.on('data', (chunk: Buffer) => {
        const n = Number.parseInt(chunk.toString(), 10);
        if (Number.isInteger(n)) resolve(n);
      });
    });
    expect(isAlive(leafPid)).toBe(true);
    await adapter.killTree(child.pid ?? 0);
    await waitUntil(() => !isAlive(leafPid));
  }, 30_000);
});
