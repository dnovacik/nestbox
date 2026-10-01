import { afterEach, describe, expect, it } from 'vitest';
import { readGitInfo } from './git-head';
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
