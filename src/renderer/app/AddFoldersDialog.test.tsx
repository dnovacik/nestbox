import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeSummary } from '@/test/fixtures';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { useUiStore } from '@/state/ui-store';
import { AddFoldersDialog } from './AddFoldersDialog';

const PENDING = {
  path: 'C:\\Dev\\Shop',
  name: 'Shop',
  folders: [
    { relPath: 'app', name: 'shop-app' },
    { relPath: 'api', name: 'shop-api' },
  ],
};

function setup() {
  const bridge = installMockBridge({
    'projects:addFolders': () => [makeSummary({ id: 'a1' }), makeSummary({ id: 'a2' })],
    'projects:add': () => makeSummary({ id: 'one' }),
    'projects:list': () => [],
    'groups:list': () => [],
  });
  useUiStore.setState({ pendingFolders: PENDING, selectedProjectId: null });
  renderWithProviders(<AddFoldersDialog />);
  return bridge;
}

beforeEach(() => useUiStore.setState({ pendingFolders: null }));

describe('AddFoldersDialog', () => {
  it('adds the sub-folders under a group named after the folder by default', async () => {
    const bridge = setup();
    const name = await screen.findByRole('textbox', { name: 'Group name' });
    expect(name).toHaveValue('Shop');
    expect(screen.getByText('shop-api')).toBeInTheDocument();
    await userEvent.clear(name);
    await userEvent.type(name, 'Clients');
    await userEvent.click(screen.getByRole('button', { name: 'Add under group' }));
    await waitFor(() =>
      expect(bridge.callsTo('projects:addFolders')).toEqual([
        { path: 'C:\\Dev\\Shop', group: 'Clients' },
      ]),
    );
    await waitFor(() => expect(useUiStore.getState().pendingFolders).toBeNull());
    expect(useUiStore.getState().selectedProjectId).toBe('a1');
  });

  it('adds them to the root on "No"', async () => {
    const bridge = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'No, add without a group' }));
    await waitFor(() =>
      expect(bridge.callsTo('projects:addFolders')).toEqual([
        { path: 'C:\\Dev\\Shop', group: null },
      ]),
    );
  });

  it('adds the folder as one project, so a run group can start its sub-folders together', async () => {
    const bridge = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Add as one project' }));
    await waitFor(() =>
      expect(bridge.callsTo('projects:add')).toEqual([{ path: 'C:\\Dev\\Shop' }]),
    );
    await waitFor(() => expect(useUiStore.getState().pendingFolders).toBeNull());
    expect(useUiStore.getState().selectedProjectId).toBe('one');
    expect(bridge.callsTo('projects:addFolders')).toEqual([]);
  });

  it('adds nothing on Cancel', async () => {
    const bridge = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(useUiStore.getState().pendingFolders).toBeNull();
    expect(bridge.callsTo('projects:addFolders')).toEqual([]);
  });
});
