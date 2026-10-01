// Test helper: a ChildProcess stand-in driven by the test. Never imported by production modules.
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';

export class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid: number | undefined;
  killed = false;
  private exited = false;

  constructor(pid: number, opts: { failSpawn?: boolean } = {}) {
    super();
    queueMicrotask(() => {
      if (opts.failSpawn) {
        this.emit('error', Object.assign(new Error('spawn cmd.exe ENOENT'), { code: 'ENOENT' }));
        this.emit('close', -2, null);
        return;
      }
      this.pid = pid;
      this.emit('spawn');
    });
  }

  kill(): boolean {
    this.killed = true;
    this.exit(null, 'SIGTERM');
    return true;
  }

  /** Ends stdio, then emits close on the next turn, like a real child. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit('close', code, signal));
  }
}

/** Lets stream data and setImmediate-based close events reach their listeners. */
export async function flushIo(): Promise<void> {
  for (let i = 0; i < 4; i++) await new Promise<void>((r) => setImmediate(r));
}

export function fakePlatform() {
  const children: FakeChild[] = [];
  let nextPid = 1000;
  let failNext = false;
  return {
    children,
    last(): FakeChild {
      const child = children.at(-1);
      if (!child) throw new Error('no child spawned');
      return child;
    },
    failNextSpawn(): void {
      failNext = true;
    },
    spawnScript: vi.fn((): ChildProcess => {
      const child = new FakeChild(nextPid++, { failSpawn: failNext });
      failNext = false;
      children.push(child);
      return child as unknown as ChildProcess;
    }),
    spawnCommand: vi.fn((): ChildProcess => {
      const child = new FakeChild(nextPid++, { failSpawn: failNext });
      failNext = false;
      children.push(child);
      return child as unknown as ChildProcess;
    }),
    // Like taskkill /F: the root exits with code 1.
    killTree: vi.fn(async (pid: number): Promise<void> => {
      children.find((c) => c.pid === pid)?.exit(1);
    }),
    listProcesses: vi.fn(async () => []),
    listListeningPorts: vi.fn(async () => []),
    describeProcesses: vi.fn(async () => new Map<number, string | null>()),
    resolveShellEnv: vi.fn(async (): Promise<NodeJS.ProcessEnv> => ({ PATH: 'x', SECRET: 'do-not-log' })),
  };
}
