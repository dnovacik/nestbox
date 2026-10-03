import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { GitStatus } from '@shared/tools/git/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useUiStore } from '@/state/ui-store';
import { okStatus } from './fixtures';
import { GitCard } from './OverviewCard';

async function renderCard(status: GitStatus) {
  const bridge = installMockBridge({ 'tools:invoke': (() => status) as never });
  renderWithProviders(<GitCard projectId="p1" />);
  const card = await screen.findByRole('region', { name: 'Git' });
  return { card, bridge };
}

describe('GitCard', () => {
  it('shows a clean branch, its upstream and the last commit', async () => {
    const { card } = await renderCard(okStatus({ ahead: 2, behind: 1, lastFetchAt: Date.now() - 3 * 3_600_000 }));
    expect(await within(card).findByText('main')).toBeInTheDocument();
    expect(within(card).getByText('Clean')).toBeInTheDocument();
    expect(within(card).getByText('↑2 ↓1')).toBeInTheDocument();
    expect(within(card).getByText('origin/main')).toBeInTheDocument();
    expect(within(card).getByText('fetched 3 h ago')).toBeInTheDocument();
    expect(within(card).getByText('feat: add the engine')).toHaveAttribute('title', 'feat: add the engine');
    expect(within(card).getByText('Ada Lovelace · 2 h ago')).toBeInTheDocument();
  });

  it('counts changes, with staged and conflicted counts and a truncated total', async () => {
    const changes = { total: 2000, staged: 3, unstaged: 1990, untracked: 7, conflicted: 1, truncated: true };
    const { card } = await renderCard(okStatus({ changes }));
    expect(await within(card).findByText('2,000+ changes')).toBeInTheDocument();
    expect(within(card).getByText('3 staged')).toBeInTheDocument();
    expect(within(card).getByText('1 conflict')).toBeInTheDocument();
  });

  it('shows a detached HEAD, an operation in progress, no upstream and no commits', async () => {
    const { card } = await renderCard(
      okStatus({ branch: null, detachedAt: 'abc1234', operation: 'rebase', upstream: null, ahead: null, behind: null, lastCommit: null }),
    );
    expect(await within(card).findByText('Detached at abc1234')).toBeInTheDocument();
    expect(within(card).getByText('Rebasing')).toBeInTheDocument();
    expect(within(card).getByText('No upstream')).toBeInTheDocument();
    expect(within(card).getByText('No commits yet')).toBeInTheDocument();
  });

  it('says when git has never fetched', async () => {
    const { card } = await renderCard(okStatus());
    expect(await within(card).findByText('never fetched')).toBeInTheDocument();
  });

  it.each<[GitStatus, RegExp]>([
    [{ state: 'git-missing' }, /git is not installed/i],
    [{ state: 'not-a-repo' }, /git can't read this folder/i],
  ])('explains %o', async (status, text) => {
    const { card } = await renderCard(status);
    expect(await within(card).findByText(text)).toBeInTheDocument();
  });

  it('offers Retry when git status failed', async () => {
    const { card, bridge } = await renderCard({ state: 'failed' });
    await userEvent.click(await within(card).findByRole('button', { name: 'Retry' }));
    expect(bridge.callsTo('tools:invoke').length).toBe(2);
  });

  it('opens the Git tab', async () => {
    const { card } = await renderCard(okStatus());
    await userEvent.click(await within(card).findByRole('button', { name: 'Open Git' }));
    expect(useUiStore.getState().activeTab.p1).toBe('git');
  });
});
