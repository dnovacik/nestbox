import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { GitStatus } from '@shared/tools/git/contract';
import type { ExecResult } from '../../platform/adapter';
import { createMemoryLogger } from '../../logger';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createGitTool, STATUS_MAX_BYTES } from './index';

const OID = '28d8048f9696af1c9a052045485e4e8ce489d31f';
const STATUS = [`# branch.oid ${OID}`, '# branch.head main', '# branch.upstream origin/main', '# branch.ab +1 -0', '? secret-plan.txt', ''].join('\0');
const COMMIT = 'tree a\nauthor Ada <ada@x> 1791027609 +0000\n\nfeat: private subject\n';

let root = '';
let tool: AnyMainTool | null = null;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nestbox-git-tool-'));
  await mkdir(join(root, '.git', 'refs'), { recursive: true });
});
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
  await rm(root, { recursive: true, force: true });
});

type Exec = (args: readonly string[]) => ExecResult | Error;

function setup(opts: { exec?: Exec; gitExists?: boolean | null; project?: Partial<DetectedProject> } = {}) {
  const execCommand = vi.fn(async (_cmd: string, args: readonly string[], _o: { cwd?: string; timeoutMs: number; maxBytes?: number }) => {
    const result = opts.exec?.(args) ?? (args.includes('status') ? { code: 0, stdout: STATUS } : { code: 0, stdout: COMMIT });
    if (result instanceof Error) throw result;
    return result;
  });
  const platform = {
    execCommand,
    commandExists: vi.fn(async () => opts.gitExists ?? true),
    openInEditor: vi.fn(async () => undefined),
  };
  const watch = vi.fn(() => () => undefined);
  const logger = createMemoryLogger();
  tool = createGitTool({ watch, logger });
  const emit = vi.fn();
  const ctx = {
    project: makeDetectedForTest({ path: root, git: { branch: 'main', head: null }, ...opts.project }),
    shared: createSharedContext().forProject('p1'),
    emit,
    platform,
    settings: { get: () => ({}), update: (fn: (s: object) => object) => fn({}) },
  } as unknown as ToolContext;
  const call = <T,>(method: string, input: unknown = {}) => tool?.handlers[method]?.(ctx, input) as Promise<T>;
  return { call, ctx, emit, platform, watch, logger, execCommand };
}

describe('git tool: status', () => {
  it('runs status and cat-file without optional locks and returns the summary', async () => {
    const { call, execCommand } = setup();
    const status = await call<GitStatus>('status');
    expect(status).toMatchObject({
      state: 'ok',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
      operation: null,
      lastFetchAt: null,
      changes: { total: 1, untracked: 1, truncated: false },
      lastCommit: { hash: '28d8048', subject: 'feat: private subject', author: 'Ada', at: 1_791_027_609_000 },
    });
    expect(execCommand.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['git', ['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal']],
      ['git', ['--no-optional-locks', 'cat-file', 'commit', OID]],
    ]);
    expect(execCommand.mock.calls[0]?.[2]).toMatchObject({ cwd: root, maxBytes: STATUS_MAX_BYTES });
  });

  it('reads the last fetch time and an operation in progress', async () => {
    await writeFile(join(root, '.git', 'FETCH_HEAD'), '');
    await writeFile(join(root, '.git', 'MERGE_HEAD'), OID);
    const status = await setup().call<GitStatus>('status');
    expect(status).toMatchObject({ state: 'ok', operation: 'merge' });
    expect(status.state === 'ok' && status.lastFetchAt).toBeGreaterThan(0);
  });

  it('skips cat-file on a branch with no commits', async () => {
    const { call, execCommand } = setup({ exec: () => ({ code: 0, stdout: '# branch.oid (initial)\0# branch.head main\0' }) });
    expect(await call<GitStatus>('status')).toMatchObject({ state: 'ok', lastCommit: null });
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it('keeps the summary when cat-file fails', async () => {
    const { call } = setup({ exec: (args) => (args.includes('status') ? { code: 0, stdout: STATUS } : { code: 128, stdout: '' }) });
    expect(await call<GitStatus>('status')).toMatchObject({ state: 'ok', lastCommit: null });
  });

  it('flags output that filled the cap', async () => {
    const { call } = setup({ exec: (args) => (args.includes('status') ? { code: 0, stdout: STATUS.padEnd(STATUS_MAX_BYTES, 'x') } : { code: 0, stdout: COMMIT }) });
    expect(await call<GitStatus>('status')).toMatchObject({ state: 'ok', changes: { truncated: true } });
  });

  it.each<[string, ExecResult | Error, boolean | null, GitStatus['state']]>([
    ['exit 128', { code: 128, stdout: '' }, true, 'not-a-repo'],
    ['a timeout', { code: null, stdout: '' }, true, 'failed'],
    ['another exit code with git present', { code: 1, stdout: '' }, true, 'failed'],
    ['another exit code without git', { code: 1, stdout: '' }, false, 'git-missing'],
    ['a spawn error without git', Object.assign(new Error('x'), { code: 'ENOENT' }), false, 'git-missing'],
    ['a spawn error when git cannot be checked', new Error('x'), null, 'failed'],
  ])('maps %s', async (_name, result, gitExists, state) => {
    expect(await setup({ exec: () => result, gitExists }).call<GitStatus>('status')).toEqual({ state });
  });

  it('says not-a-repo when the .git is gone, without running git', async () => {
    await rm(join(root, '.git'), { recursive: true });
    const { call, execCommand } = setup();
    expect(await call<GitStatus>('status')).toEqual({ state: 'not-a-repo' });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('starts one watcher that emits changed', async () => {
    const { call, watch, emit } = setup();
    await call('status');
    await call('status');
    expect(watch).toHaveBeenCalledTimes(2); // gitdir + refs, once
    vi.useFakeTimers();
    try {
      const onChange = (watch.mock.calls[0] as unknown as [string, boolean, (n: string) => void])[2];
      onChange('HEAD');
      vi.advanceTimersByTime(300);
      expect(emit).toHaveBeenCalledWith('changed', undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never logs file names, subjects or authors', async () => {
    const { call, logger } = setup({ exec: (args) => (args.includes('status') ? { code: 2, stdout: STATUS } : { code: 0, stdout: COMMIT }) });
    await call('status');
    await setup().call('status');
    const logged = JSON.stringify(logger.entries);
    expect(logged).not.toMatch(/secret-plan|private subject|Ada/);
  });
});

describe('git tool: openFile', () => {
  it('opens an existing file inside the repository', async () => {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'a b.ts'), '');
    const { call, platform } = setup();
    await call('openFile', { path: 'src/a b.ts' });
    expect(platform.openInEditor).toHaveBeenCalledWith(join(root, 'src', 'a b.ts'));
  });

  it.each(['../outside.ts', 'src/../../x', '/etc/passwd', 'C:\\Windows\\x', '\\\\server\\share', 'a\\..\\..\\b'])('rejects %s', async (path) => {
    const { call, platform } = setup();
    await expect(call('openFile', { path })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(platform.openInEditor).not.toHaveBeenCalled();
  });

  it('says NOT_FOUND for a deleted file or a folder', async () => {
    await mkdir(join(root, 'dir'));
    const { call } = setup();
    await expect(call('openFile', { path: 'gone.ts' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(call('openFile', { path: 'dir' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
