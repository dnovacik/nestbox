import { describe, expect, it } from 'vitest';
import { spawnRunner } from './command-runner';

const node = process.execPath;

describe('spawnRunner.exec', () => {
  it('resolves with the exit code and stdout', async () => {
    expect(await spawnRunner.exec(node, ['-e', 'process.stdout.write("hi"); process.exit(3)'])).toEqual({
      code: 3,
      stdout: 'hi',
    });
  });

  it('rejects when the program cannot start', async () => {
    await expect(spawnRunner.exec('definitely-not-a-program-nestbox', [])).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('caps stdout at 64 KiB', async () => {
    const { stdout } = await spawnRunner.exec(node, ['-e', 'process.stdout.write("x".repeat(200000))']);
    expect(stdout).toHaveLength(65_536);
  });

  it('runs in the given folder', async () => {
    const { tmpdir } = await import('node:os');
    const { realpathSync } = await import('node:fs');
    const { stdout } = await spawnRunner.exec(node, ['-e', 'process.stdout.write(process.cwd())'], { cwd: tmpdir() });
    expect(realpathSync(stdout)).toBe(realpathSync(tmpdir()));
  });

  it('takes a larger cap when asked', async () => {
    const { stdout } = await spawnRunner.exec(node, ['-e', 'process.stdout.write("x".repeat(200000))'], { maxBytes: 1_048_576 });
    expect(stdout).toHaveLength(200_000);
  });

  it('passes the given environment', async () => {
    const { stdout } = await spawnRunner.exec(node, ['-e', 'process.stdout.write(process.env.NESTBOX_T ?? "")'], {
      env: { ...process.env, NESTBOX_T: 'C' },
    });
    expect(stdout).toBe('C');
  });

  it('gives up after the timeout with a null code', async () => {
    const started = Date.now();
    const result = await spawnRunner.exec(node, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 200 });
    expect(result.code).toBeNull();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe('spawnRunner.spawn', () => {
  it('pipes stdout and stderr and passes cwd and env', async () => {
    const child = spawnRunner.spawn(
      node,
      ['-e', 'console.log(process.cwd()); console.error(process.env.NESTBOX_T)'],
      { cwd: process.cwd(), env: { ...process.env, NESTBOX_T: 'ok' } },
    );
    let out = '';
    let err = '';
    child.stdout?.on('data', (c: Buffer) => (out += c.toString()));
    child.stderr?.on('data', (c: Buffer) => (err += c.toString()));
    const code = await new Promise((r) => child.once('close', r));
    expect(code).toBe(0);
    expect(out.trim()).toBe(process.cwd());
    expect(err.trim()).toBe('ok');
  });

  it('writes stdin when asked and closes it', async () => {
    const child = spawnRunner.spawn(node, ['-e', 'process.stdin.pipe(process.stdout)'], {
      cwd: process.cwd(),
      env: process.env,
      stdin: 'say "hi"\nand bye',
    });
    let out = '';
    child.stdout?.on('data', (c: Buffer) => (out += c.toString()));
    await new Promise((r) => child.once('close', r));
    expect(out).toBe('say "hi"\nand bye');
  });

  // POSIX only: a new process group lets killTree signal the whole tree at once.
  it.skipIf(process.platform === 'win32')('starts a new process group when asked', async () => {
    const child = spawnRunner.spawn(node, ['-e', 'setTimeout(() => {}, 5000)'], {
      cwd: process.cwd(),
      env: process.env,
      newProcessGroup: true,
    });
    await new Promise((r) => child.once('spawn', r));
    const pid = child.pid ?? 0;
    const { stdout } = await spawnRunner.exec('ps', ['-o', 'pgid=', '-p', String(pid)]);
    child.kill('SIGKILL');
    expect(Number(stdout.trim())).toBe(pid);
  });
});
