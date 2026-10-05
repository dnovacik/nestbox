import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DetectedProject, ProjectSummary } from '@shared/detected';
import { makeDetectedForTest } from '@shared/test-fixtures';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { ProjectHeader } from './ProjectHeader';

function node(git: DetectedProject['git']) {
  const detected = makeDetectedForTest({ id: 'p1', path: 'C:\\Dev\\Shop', name: 'shop', git });
  const summary: ProjectSummary = {
    id: 'p1',
    name: 'shop',
    path: 'C:\\Dev\\Shop',
    pinned: false,
    groupId: null,
    tags: [],
    detected,
  };
  return { summary, detected, isWorkspace: false };
}

function setup(gitStatus: unknown, git: DetectedProject['git']) {
  const bridge = installMockBridge({
    'processes:list': () => [],
    'tools:invoke': (() => gitStatus) as never,
  });
  renderWithProviders(<ProjectHeader node={node(git)} />);
  return bridge;
}

const okStatus = (branch: string | null, detachedAt: string | null = null) => ({
  state: 'ok',
  branch,
  detachedAt,
  operation: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  lastFetchAt: null,
  changes: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, truncated: false },
  files: [],
  lastCommit: null,
});

describe('ProjectHeader branch', () => {
  it('shows the live branch from the git tool, not the one detected when the project was added', async () => {
    setup(okStatus('feature/login'), { branch: 'main', head: 'abc1234' });
    expect(await screen.findByText('feature/login')).toBeInTheDocument();
    expect(screen.queryByText('main')).toBeNull();
  });

  it('shows the detached commit, and falls back to detection until the status arrives', async () => {
    setup(okStatus(null, 'def5678'), { branch: 'main', head: 'abc1234' });
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(await screen.findByText('def5678')).toBeInTheDocument();
  });

  it('asks git nothing for a folder that is not a repository', async () => {
    const bridge = setup(okStatus('x'), null);
    await screen.findByRole('heading', { name: 'shop' });
    await waitFor(() => expect(bridge.callsTo('tools:invoke')).toEqual([]));
  });
});
