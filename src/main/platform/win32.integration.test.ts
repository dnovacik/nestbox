import { spawn } from 'node:child_process';
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
  // Each test waits for its tree to close, but Windows can keep the folder busy a little longer (a
  // virus scan, a handle being released). It is a temp folder, so cleanup is best effort.
  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // left for the OS to clean up
    }
  });

  it('spawns through cmd.exe, lists it with its start time and kills the process', async () => {
    const child = adapter.spawnScript({
      cwd: dir,
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      env: process.env,
    });
    const closed = new Promise((r) => child.once('close', r));
    await new Promise((r) => child.once('spawn', r));
    const spawnedAt = Date.now();
    const pid = child.pid ?? 0;
    try {
      // A cold PowerShell on a CI runner can take over 10 s.
      const processes = await adapter.listProcesses();
      const root = processes?.find((p) => p.pid === pid);
      expect(root?.parentPid).toBe(process.pid);
      expect(Math.abs((root?.startTime ?? 0) - spawnedAt)).toBeLessThan(3_000);
    } finally {
      await adapter.killTree(pid);
    }
    await waitUntil(() => !isAlive(pid));
    await closed;
  }, 60_000);

  it('kills grandchildren too', async () => {
    writeFileSync(join(dir, 'leaf.js'), 'console.log(process.pid); setInterval(() => {}, 1000);');
    writeFileSync(
      join(dir, 'tree.js'),
      "require('child_process').spawn(process.execPath, [require('path').join(__dirname, 'leaf.js')], { stdio: 'inherit' }); setInterval(() => {}, 1000);",
    );
    const child = adapter.spawnScript({ cwd: dir, command: process.execPath, args: ['tree.js'], env: process.env });
    // 'close' waits for every process sharing the output pipes, so the whole tree has exited.
    const closed = new Promise((r) => child.once('close', r));
    const leafPid = await new Promise<number>((resolve) => {
      child.stdout?.on('data', (chunk: Buffer) => {
        const n = Number.parseInt(chunk.toString(), 10);
        if (Number.isInteger(n)) resolve(n);
      });
    });
    expect(isAlive(leafPid)).toBe(true);
    await adapter.killTree(child.pid ?? 0);
    await waitUntil(() => !isAlive(leafPid));
    await closed;
  }, 30_000);
});

describe.runIf(process.platform === 'win32')('win32 ports (integration)', () => {
  const adapter = createWin32Adapter({ runner: spawnRunner, getEditorCommand: () => 'code' });

  it('lists a listening node server with its PID and command line', async () => {
    const child = spawn(
      process.execPath,
      ['-e', "require('net').createServer().listen(0, '127.0.0.1', function () { console.log(this.address().port) })"],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    try {
      const port = await new Promise<number>((resolve) => {
        child.stdout?.once('data', (chunk: Buffer) => resolve(Number.parseInt(chunk.toString(), 10)));
      });
      const rows = await adapter.listListeningPorts();
      const row = rows.find((r) => r.port === port);
      expect(row).toMatchObject({ pid: child.pid, addresses: ['127.0.0.1'], processName: 'node.exe' });
      const commands = await adapter.describeProcesses([child.pid ?? 0]);
      expect(commands.get(child.pid ?? 0)).toContain('createServer');
    } finally {
      child.kill();
    }
  }, 60_000);
});
