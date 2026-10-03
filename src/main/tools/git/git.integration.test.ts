// The git tool against a real repository and the real git, through the platform adapter of this OS.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { GitStatus } from '@shared/tools/git/contract';
import { watchDir } from '../../fs/watch-dir';
import { createMemoryLogger } from '../../logger';
import { spawnRunner } from '../../platform/command-runner';
import { createPlatformAdapter } from '../../platform';
import { createSharedContext } from '../shared-context';
import type { ToolContext } from '../types';
import { createGitTool } from './index';

const hasGit = spawnSync('git', ['--version']).status === 0;

describe.runIf(hasGit)('git tool on a real repository (integration)', () => {
  let repo = '';
  const tool = createGitTool({ watch: watchDir, logger: createMemoryLogger() });
  const emit = vi.fn();
  let ctx: ToolContext;
  // Never the user's signing or hooks: a commit here must work on any machine.
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args], { cwd: repo, stdio: 'pipe' });

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'nestbox-git-int-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Ünï Tester');
    git('config', 'user.email', 'tester@example.com');
    await writeFile(join(repo, 'a.txt'), 'a\n');
    await writeFile(join(repo, 'staged.txt'), 's\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'first commit');
    await writeFile(join(repo, 'a.txt'), 'changed\n');
    git('add', 'staged.txt');
    await writeFile(join(repo, 'new file é.txt'), 'n\n');
    ctx = {
      project: makeDetectedForTest({ path: repo, git: { branch: 'main', head: null } }),
      shared: createSharedContext().forProject('p1'),
      emit,
      platform: createPlatformAdapter({ runner: spawnRunner, getEditorCommand: () => 'code' }),
      settings: { get: () => ({}), update: (fn: (s: object) => object) => fn({}) },
    } as unknown as ToolContext;
  });
  afterAll(async () => {
    await tool.dispose?.();
    await rm(repo, { recursive: true, force: true });
  });

  it('reads the branch, the changes and the last commit', async () => {
    const status = (await tool.handlers.status?.(ctx, {})) as GitStatus;
    expect(status).toMatchObject({
      state: 'ok',
      branch: 'main',
      upstream: null,
      operation: null,
      changes: { total: 3, staged: 1, unstaged: 1, untracked: 1, conflicted: 0, truncated: false },
      lastCommit: { subject: 'first commit', author: 'Ünï Tester' },
    });
    if (status.state !== 'ok') return;
    expect(status.files.map((f) => [f.group, f.path])).toEqual([
      ['changes', 'a.txt'],
      ['staged', 'staged.txt'],
      ['untracked', 'new file é.txt'],
    ]);
  }, 30_000);

  it('emits changed after a commit', async () => {
    await tool.handlers.status?.(ctx, {});
    emit.mockClear();
    git('commit', '-q', '-m', 'second');
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('changed', undefined), { timeout: 10_000, interval: 100 });
  }, 30_000);
});
