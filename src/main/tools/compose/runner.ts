// Runs `docker compose -f <file> …` in one package: short commands to completion, actions one at a time with
// their output in the Actions log, and at most one followed service log. Arguments are NestBox tokens, the
// detected file name and validated service names only.
import type { ChildProcess } from 'node:child_process';
import { NestboxError } from '@shared/errors';
import type { LogLine } from '@shared/processes';
import type { ActionResult, ComposeAction, LogSource } from '@shared/tools/compose/contract';
import type { Logger } from '../../logger';
import type { PlatformAdapter } from '../../platform/adapter';
import { LineSplitter } from '../../processes/line-splitter';
import { BatchedLog } from '../batched-log';

export type ComposePlatform = Pick<
  PlatformAdapter,
  'spawnCommand' | 'killTree' | 'resolveShellEnv'
>;

export const ACTION_TIMEOUT_MS = 10 * 60_000;
const LOG_LINES = 5_000;
const STDERR_CAP = 64 * 1024;

export interface Collected {
  /** null when it couldn't start, timed out or was killed. */
  code: number | null;
  stdout: string;
  /** Only for classifying a failure; never shown or logged. */
  stderr: string;
}

function composeArgs(file: string, rest: readonly string[]): string[] {
  return ['compose', '-f', file, ...rest];
}

/** Runs one docker compose command to completion (config, ps). */
export async function collect(
  platform: ComposePlatform,
  opts: { cwd: string; file: string; args: readonly string[]; timeoutMs: number; maxBytes: number },
): Promise<Collected> {
  const env = await platform.resolveShellEnv();
  const child = platform.spawnCommand({
    cwd: opts.cwd,
    command: 'docker',
    args: composeArgs(opts.file, opts.args),
    env,
  });
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < opts.maxBytes) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_CAP) stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      if (child.pid !== undefined) void platform.killTree(child.pid).catch(() => undefined);
      finish(null);
    }, opts.timeoutMs);
    child.once('error', () => finish(null));
    child.once('close', (code: number | null) => finish(code));
  });
}

interface Run {
  child: ChildProcess;
  stopping: boolean;
}

export interface ComposePackageDeps {
  platform: ComposePlatform;
  logger: Logger;
  cwd: string;
  file: string;
  projectId: string;
  /** Replaced with a fresh one on every call (tool contexts are built per call). */
  emit: { changed(): void; logs(source: LogSource, lines: LogLine[]): void };
  actionTimeoutMs?: number;
}

/** The compose state of one package: the running action, the followed service and the two logs. */
export class ComposePackage {
  readonly logs: Record<LogSource, BatchedLog>;
  action: { name: ComposeAction; service: string | null } | null = null;
  following: string | null = null;
  private actionRun: Run | null = null;
  private follower: Run | null = null;
  private disposed = false;
  /** Bumped by every follow and unfollow: a follower spawned for an older one is killed at once. */
  private followSeq = 0;

  constructor(private readonly deps: ComposePackageDeps) {
    this.logs = {
      actions: new BatchedLog(LOG_LINES, (lines) => this.deps.emit.logs('actions', lines)),
      service: new BatchedLog(LOG_LINES, (lines) => this.deps.emit.logs('service', lines)),
    };
  }

  setEmit(emit: ComposePackageDeps['emit']): void {
    this.deps.emit = emit;
  }

  private async spawn(
    args: readonly string[],
    log: BatchedLog,
  ): Promise<{ run: Run; done: Promise<number | null> }> {
    const env = await this.deps.platform.resolveShellEnv();
    const child = this.deps.platform.spawnCommand({
      cwd: this.deps.cwd,
      command: 'docker',
      args: composeArgs(this.deps.file, args),
      env,
    });
    const run: Run = { child, stopping: false };
    const splitters = { stdout: new LineSplitter(), stderr: new LineSplitter() };
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream]?.on('data', (chunk: Buffer) => {
        for (const line of splitters[stream].push(chunk)) log.push(stream, line);
      });
    }
    const done = new Promise<number | null>((resolve) => {
      let ended = false;
      const end = (code: number | null) => {
        if (ended) return;
        ended = true;
        for (const stream of ['stdout', 'stderr'] as const)
          for (const line of splitters[stream].flush(true)) log.push(stream, line);
        resolve(code);
      };
      child.once('error', () => end(null));
      child.once('close', (code: number | null) => end(code));
    });
    return { run, done };
  }

  private async kill(run: Run | null): Promise<void> {
    if (!run || run.stopping) return;
    run.stopping = true;
    if (run.child.pid !== undefined)
      await this.deps.platform.killTree(run.child.pid).catch(() => undefined);
  }

  async runAction(name: ComposeAction, service: string | null): Promise<ActionResult> {
    if (this.disposed) throw new NestboxError('NOT_FOUND', 'This package is gone');
    if (this.action) throw new NestboxError('CONFLICT', 'Another Compose action is running');
    const args = name === 'up' ? ['up', '-d'] : [name];
    if (service !== null) args.push(service);
    this.action = { name, service };
    this.deps.emit.changed();
    const started = Date.now();
    this.logs.actions.push('system', `▸ docker compose ${args.join(' ')}`);
    const { run, done } = await this.spawn(args, this.logs.actions);
    this.actionRun = run;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void this.kill(run);
    }, this.deps.actionTimeoutMs ?? ACTION_TIMEOUT_MS);
    const code = await done;
    clearTimeout(timer);
    const ok = code === 0 && !run.stopping;
    this.logs.actions.push(
      'system',
      timedOut
        ? '■ timed out'
        : run.stopping
          ? '■ stopped'
          : ok
            ? '■ done'
            : `■ exited with code ${code ?? 'unknown'}`,
    );
    this.deps.logger.info('compose action', {
      projectId: this.deps.projectId,
      action: name,
      code: code ?? 'none',
      ms: Date.now() - started,
    });
    this.actionRun = null;
    this.action = null;
    if (!this.disposed) this.deps.emit.changed();
    return { ok, code: run.stopping ? null : code };
  }

  async follow(service: string): Promise<void> {
    if (this.disposed) return;
    await this.unfollow(false);
    const seq = ++this.followSeq;
    this.following = service;
    this.logs.service.clear();
    const { run, done } = await this.spawn(
      ['logs', '-f', '--no-color', '--no-log-prefix', '--tail', '500', service],
      this.logs.service,
    );
    if (seq !== this.followSeq || this.disposed) {
      await this.kill(run);
      return;
    }
    this.follower = run;
    this.deps.emit.changed();
    void done.then(() => {
      if (this.follower !== run) return;
      this.follower = null;
      this.following = null;
      if (!run.stopping) this.logs.service.push('system', '■ log stream ended');
      if (!this.disposed) this.deps.emit.changed();
    });
  }

  async unfollow(notify = true): Promise<void> {
    const run = this.follower;
    this.followSeq++;
    this.follower = null;
    this.following = null;
    await this.kill(run);
    if (notify && run && !this.disposed) this.deps.emit.changed();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([this.kill(this.actionRun), this.kill(this.follower)]);
    this.follower = null;
    this.following = null;
    this.logs.actions.dispose();
    this.logs.service.dispose();
  }
}
