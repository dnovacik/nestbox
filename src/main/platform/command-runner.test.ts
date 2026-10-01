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

  it('takes a larger cap when asked', async () => {
    const { stdout } = await spawnRunner.exec(node, ['-e', 'process.stdout.write("x".repeat(200000))'], { maxBytes: 1_048_576 });
    expect(stdout).toHaveLength(200_000);
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
});
