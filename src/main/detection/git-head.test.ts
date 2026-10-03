import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readGitInfo, resolveGitDirs } from './git-head';
import { makeTree, removeTree } from './test-fixtures';

const SHA = 'a8f912c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6';
let dir = '';
afterEach(async () => removeTree(dir));

describe('readGitInfo', () => {
  it('returns null when there is no .git', async () => {
    dir = await makeTree({ 'package.json': '{}' });
    expect(await readGitInfo(dir)).toBeNull();
  });

  it('reads the branch from .git/HEAD', async () => {
    dir = await makeTree({ '.git/HEAD': 'ref: refs/heads/feature/mcp-integration\n' });
    expect(await readGitInfo(dir)).toEqual({ branch: 'feature/mcp-integration', head: null });
  });

  it('reports a detached HEAD as a short hash', async () => {
    dir = await makeTree({ '.git/HEAD': `${SHA}\n` });
    expect(await readGitInfo(dir)).toEqual({ branch: null, head: 'a8f912c' });
  });

  it('follows a worktree .git file to its gitdir', async () => {
    dir = await makeTree({
      'main/.git/worktrees/wt1/HEAD': 'ref: refs/heads/m0-skeleton\n',
      'wt1/.git': 'gitdir: ../main/.git/worktrees/wt1\n',
    });
    expect(await readGitInfo(`${dir}/wt1`)).toEqual({ branch: 'm0-skeleton', head: null });
  });

  it('returns unknown branch for an unreadable HEAD', async () => {
    dir = await makeTree({ '.git': null });
    expect(await readGitInfo(dir)).toEqual({ branch: null, head: null });
  });
});

describe('resolveGitDirs', () => {
  it('returns null when there is no .git', async () => {
    dir = await makeTree({ 'package.json': '{}' });
    expect(await resolveGitDirs(dir)).toBeNull();
  });

  it('uses a .git folder as both the gitdir and the common dir', async () => {
    dir = await makeTree({ '.git/HEAD': 'ref: refs/heads/main\n' });
    expect(await resolveGitDirs(dir)).toEqual({ gitDir: join(dir, '.git'), commonDir: join(dir, '.git') });
  });

  it('follows a linked worktree to its gitdir and the common dir', async () => {
    dir = await makeTree({
      'main/.git/worktrees/wt1/HEAD': 'ref: refs/heads/m0-skeleton\n',
      'main/.git/worktrees/wt1/commondir': '../..\n',
      'wt1/.git': 'gitdir: ../main/.git/worktrees/wt1\n',
    });
    expect(await resolveGitDirs(join(dir, 'wt1'))).toEqual({
      gitDir: join(dir, 'main', '.git', 'worktrees', 'wt1'),
      commonDir: join(dir, 'main', '.git'),
    });
  });

  it('uses the gitdir as the common dir when there is no commondir file (a submodule)', async () => {
    dir = await makeTree({ 'parent/.git/modules/sub/HEAD': 'x', 'parent/sub/.git': 'gitdir: ../.git/modules/sub\n' });
    const gitDir = join(dir, 'parent', '.git', 'modules', 'sub');
    expect(await resolveGitDirs(join(dir, 'parent', 'sub'))).toEqual({ gitDir, commonDir: gitDir });
  });

  it('returns null for a .git file without a gitdir pointer', async () => {
    dir = await makeTree({ '.git': 'nonsense' });
    expect(await resolveGitDirs(dir)).toBeNull();
  });
});
