import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DepsOverview } from '@shared/tools/deps/contract';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { LODASH, result, row } from '@/tools/deps/fixtures';
import { DepsPage } from './DepsPage';

const overview: DepsOverview = {
  projects: [
    { id: 'p1', name: 'shop', packages: [result()], checking: false },
    {
      id: 'p2',
      name: 'blog',
      packages: [
        result({
          projectId: 'p2',
          rows: [row({ name: 'lodash', range: '^4.17.21', current: '4.17.21' })],
        }),
      ],
      checking: false,
    },
    { id: 'p3', name: 'docs', packages: [], checking: false },
  ],
  runningAll: false,
  schedule: 'weekly',
};

function setup(data: DepsOverview = overview) {
  const calls: string[] = [];
  installMockBridge({
    'deps:overview': (() => {
      calls.push('overview');
      return data;
    }) as never,
    'deps:checkAll': (() => {
      calls.push('checkAll');
    }) as never,
  });
  renderWithProviders(<DepsPage />);
  return { calls };
}

describe('DepsPage', () => {
  it('lists projects with high or critical advisories first, and every project with its last check', async () => {
    setup();
    const urgent = await screen.findByRole('region', { name: 'High or critical advisories' });
    expect(
      within(urgent)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['shop1 high']);
    const projects = screen.getByRole('region', { name: 'Projects' });
    expect(within(projects).getByText('Not checked yet')).toBeInTheDocument();
    expect(screen.getByText('Checked weekly in the background (Settings).')).toBeInTheDocument();
  });

  it('finds every project using a package, with its versions', async () => {
    setup();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Package name' }), 'loda');
    const table = screen.getByRole('table', { name: 'Projects using lodash' });
    expect(
      within(table)
        .getAllByRole('row')
        .map((r) => r.textContent),
    ).toEqual([`shoproot${LODASH.range}${LODASH.current}→ 4.18.1high`, 'blogroot^4.17.214.17.21']);
  });

  it('opens a project on its Dependencies tab, and starts Check all', async () => {
    const { calls } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Check all now' }));
    await waitFor(() => expect(calls).toContain('checkAll'));
    const projects = screen.getByRole('region', { name: 'Projects' });
    await userEvent.click(within(projects).getByRole('button', { name: 'blog' }));
    expect(useUiStore.getState()).toMatchObject({
      view: 'project',
      selectedProjectId: 'p2',
      activeTab: { p2: 'deps' },
    });
  });
});
