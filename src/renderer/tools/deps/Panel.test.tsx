import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Results } from '@shared/tools/deps/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { DepsCard } from './OverviewCard';
import DepsPanel from './Panel';
import { result } from './fixtures';

function setup(results: Results) {
  const calls: { channel: string; method?: string; input?: unknown }[] = [];
  const bridge = installMockBridge({
    'tools:invoke': (({ method, input }: { method: string; input: unknown }) => {
      calls.push({ channel: 'tools:invoke', method, input });
      if (method === 'copyUpdateCommand') return { command: 'npm install -D semver@latest' };
      return results;
    }) as never,
    'app:openExternal': ((input: unknown) => {
      calls.push({ channel: 'app:openExternal', input });
    }) as never,
  });
  return { calls, bridge };
}

describe('DepsCard', () => {
  it('says when nothing was checked yet and never checks on its own', async () => {
    const { calls } = setup({ packages: [], checking: false });
    renderWithProviders(<DepsCard projectId="p1" />);
    const card = await screen.findByRole('region', { name: 'Dependencies' });
    expect(await within(card).findByText('Not checked yet.')).toBeInTheDocument();
    expect(calls.map((c) => c.method)).toEqual(['results']);
  });

  it('counts outdated, major and vulnerable dependencies, and checks on click', async () => {
    const { calls } = setup({ packages: [result()], checking: false });
    renderWithProviders(<DepsCard projectId="p1" />);
    const card = await screen.findByRole('region', { name: 'Dependencies' });
    expect(await within(card).findByText(/2 outdated/)).toHaveTextContent(
      '2 outdated (1 major) · 1 vulnerable (1 high)',
    );
    expect(within(card).getByText('checked 2 h ago')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'check')).toBe(true));
  });
});

describe('DepsPanel', () => {
  it('lists vulnerable first, then major updates, and filters', async () => {
    setup({ packages: [result()], checking: false });
    renderWithProviders(<DepsPanel projectId="p1" />);
    const table = await screen.findByRole('table', { name: 'Dependency list' });
    const names = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.querySelector('td')?.textContent);
    expect(names).toEqual(['lodash', 'semver', 'ms']);
    await userEvent.click(screen.getByRole('button', { name: 'Vulnerable' }));
    expect(
      within(screen.getByRole('table', { name: 'Dependency list' })).getAllByRole('row'),
    ).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search dependencies' }), 'sem');
    expect(
      within(screen.getByRole('table', { name: 'Dependency list' })).getAllByRole('row'),
    ).toHaveLength(2);
  });

  it('opens an advisory link and copies the update command', async () => {
    const { calls } = setup({ packages: [result()], checking: false });
    renderWithProviders(<DepsPanel projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: '1 advisory for lodash' }));
    const list = screen.getByRole('list', { name: 'Advisories for lodash' });
    expect(list).toHaveTextContent('Command Injection in lodash');
    await userEvent.click(within(list).getByRole('button', { name: /GHSA-35jh-r3h4-6jhm/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy update command for semver' }));
    await waitFor(() =>
      expect(
        calls
          .filter((c) => c.channel === 'app:openExternal' || c.method === 'copyUpdateCommand')
          .map((c) => c.input),
      ).toEqual([
        { url: 'https://github.com/advisories/GHSA-35jh-r3h4-6jhm' },
        { relPath: '', name: 'semver' },
      ]),
    );
    expect(await screen.findByText('Copied: npm install -D semver@latest')).toBeInTheDocument();
  });

  it('picks a workspace package and shows failed steps', async () => {
    setup({
      packages: [
        result(),
        result({
          projectId: 'p1::packages/api',
          relPath: 'packages/api',
          rows: [],
          errors: [{ step: 'audit', code: 'timeout' }],
        }),
      ],
      checking: false,
    });
    renderWithProviders(<DepsPanel projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'packages/api' }));
    expect(screen.getByText(/Audit timed out/)).toBeInTheDocument();
    expect(screen.getByText('Nothing to show.')).toBeInTheDocument();
  });
});
