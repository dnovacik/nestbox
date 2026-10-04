import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { makeProcess } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { RunGroups } from './RunGroups';
import { installScriptsBridge } from './test-bridge';

const packages = [
  { relPath: '', name: 'shop', scripts: ['dev', 'build'] },
  { relPath: 'packages/api', name: '@shop/api', scripts: ['dev'] },
];
const group = { name: 'dev', entries: [{ relPath: 'packages/api', script: 'dev' }], compose: [] };

describe('RunGroups', () => {
  it('is absent on a workspace package', async () => {
    const { calls } = installScriptsBridge({ runGroups: null, packages: null });
    renderWithProviders(<RunGroups projectId="p1::packages/api" />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Run groups' })).toBeNull();
  });

  it('starts a group and reports skipped scripts', async () => {
    const { callsTo } = installScriptsBridge({
      runGroups: [group],
      packages,
      methods: {
        startRunGroup: () => ({ started: [], skipped: [{ relPath: 'packages/gone', script: 'dev', reason: 'missing' }] }),
      },
    });
    renderWithProviders(<RunGroups projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Start group dev' }));
    await waitFor(() => expect(callsTo('startRunGroup')).toEqual([{ name: 'dev' }]));
    expect(await screen.findByText('Skipped 1 script: packages/gone dev (missing)')).toBeInTheDocument();
  });

  it('offers Stop while one of its scripts runs', async () => {
    const { callsTo } = installScriptsBridge({
      runGroups: [group],
      packages,
      processes: [makeProcess({ projectId: 'p1::packages/api', script: 'dev', state: 'running' })],
    });
    renderWithProviders(<RunGroups projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Stop group dev' }));
    await waitFor(() => expect(callsTo('stopRunGroup')).toEqual([{ name: 'dev' }]));
  });

  it('creates a group from checked scripts in order', async () => {
    const { callsTo } = installScriptsBridge({ runGroups: [], packages });
    renderWithProviders(<RunGroups projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'New group' }));
    const dialog = await screen.findByRole('dialog', { name: 'New run group' });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Group name' }), 'all');
    expect(save).toBeDisabled();
    const api = within(within(dialog).getByRole('group', { name: 'packages/api' })).getByRole('checkbox', { name: 'dev' });
    const rootBuild = within(within(dialog).getByRole('group', { name: 'Root' })).getByRole('checkbox', { name: 'build' });
    await userEvent.click(api);
    await userEvent.click(rootBuild);
    await userEvent.click(save);
    await waitFor(() =>
      expect(callsTo('saveRunGroup')).toEqual([
        {
          group: {
            name: 'all',
            entries: [
              { relPath: 'packages/api', script: 'dev' },
              { relPath: '', script: 'build' },
            ],
            compose: [],
          },
        },
      ]),
    );
  });

  it('edits with the previous name', async () => {
    const { callsTo } = installScriptsBridge({ runGroups: [group], packages });
    renderWithProviders(<RunGroups projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit group dev' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit run group' });
    const name = within(dialog).getByRole('textbox', { name: 'Group name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'backend');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(callsTo('saveRunGroup')).toEqual([{ previousName: 'dev', group: { ...group, name: 'backend' } }]),
    );
  });

  it('deletes only after confirming', async () => {
    const { callsTo } = installScriptsBridge({ runGroups: [group], packages });
    renderWithProviders(<RunGroups projectId="p1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete group dev' }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(callsTo('deleteRunGroup')).toEqual([{ name: 'dev' }]));
  });
});
