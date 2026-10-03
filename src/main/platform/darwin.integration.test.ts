// Real processes, real ps and signals. The POSIX parts run on Linux too; lsof and the login shell need macOS.
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnRunner } from './command-runner';
import { createDarwinAdapter } from './darwin';

const posix = process.platform !== 'win32';
const mac = process.platform === 'darwin';
const node = process.execPath;

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Alive and not a zombie: an orphan whose init never reaps it (some containers) still answers kill(pid, 0). */
async function isRunning(pid: number): Promise<boolean> {
  if (!isAlive(pid)) return false;
  const { stdout } = await spawnRunner.exec('/bin/ps', ['-o', 'stat=', '-p', String(pid)]);
  return stdout.trim() !== '' && !stdout.trim().startsWith('Z');
}

async function waitUntil(check: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const until = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const adapter = createDarwinAdapter({ runner: spawnRunner, getEditorCommand: () => 'code' });
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe.skipIf(!posix)('darwin adapter on real processes', () => {
  it('kills a script and the grandchild it started', async () => {
    // The child prints its grandchild's PID, then both idle.
    const script = `const { spawn } = require('node:child_process');
      const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      console.log(g.pid); setInterval(() => {}, 1000);`;
    const child = adapter.spawnScript({ cwd: process.cwd(), command: node, args: ['-e', script], env: process.env });
    const grandchild = await new Promise<number>((resolve) => child.stdout?.once('data', (d: Buffer) => resolve(Number(d.toString().trim()))));
    const pid = child.pid ?? 0;
    expect((await isRunning(pid)) && (await isRunning(grandchild))).toBe(true);
    const closed = new Promise((r) => child.once('close', r));
    await adapter.killTree(pid);
    await closed;
    await waitUntil(async () => !(await isRunning(grandchild)));
  }, 20_000);

  it('lists a child with its parent and a recent start time', async () => {
    const child = adapter.spawnScript({ cwd: process.cwd(), command: node, args: ['-e', 'setInterval(() => {}, 1000)'], env: process.env });
    await new Promise((r) => child.once('spawn', r));
    const list = (await adapter.listProcesses()) ?? [];
    const entry = list.find((p) => p.pid === child.pid);
    expect(entry?.parentPid).toBe(process.pid);
    expect(Math.abs((entry?.startTime ?? 0) - Date.now())).toBeLessThan(5_000);
    const described = await adapter.describeProcesses([child.pid ?? 0]);
    expect(described.get(child.pid ?? 0)).toContain('setInterval');
    const closed = new Promise((r) => child.once('close', r));
    await adapter.killTree(child.pid ?? 0);
    await closed;
  });

  it('writes stdin to a spawned command', async () => {
    const child = adapter.spawnCommand({ cwd: process.cwd(), command: node, args: ['-e', 'process.stdin.pipe(process.stdout)'], env: process.env, stdin: 'say "hi"' });
    let out = '';
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    await new Promise((r) => child.once('close', r));
    expect(out).toBe('say "hi"');
  });
});

describe.skipIf(!mac)('darwin adapter on macOS', () => {
  it('sees a listening socket through lsof', async () => {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const ports = await adapter.listListeningPorts();
    expect(ports.find((p) => p.port === port)).toMatchObject({ pid: process.pid, addresses: ['127.0.0.1'] });
  });

  it('reads the login-shell environment', async () => {
    const env = await adapter.resolveShellEnv();
    expect(env['PATH']).toContain('/usr/bin');
  });

  it('finds system commands on PATH', async () => {
    expect(await adapter.commandExists('ls')).toBe(true);
    expect(await adapter.commandExists('definitely-not-installed-nestbox')).toBe(false);
  });
});
