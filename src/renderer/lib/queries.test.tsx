import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NestboxError } from '@shared/errors';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge } from '@/test/mock-bridge';
import { makeSummary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { AppSettingsSchema } from '@shared/types';
import { useAddProject, useProjectsChangedSubscription, useSettings, useUpdateSettings } from './queries';

function AddButton() {
  const add = useAddProject();
  return (
    <button type="button" onClick={() => add.mutate()}>
      add
    </button>
  );
}

describe('useAddProject', () => {
  it('picks a folder, adds it and selects the new project', async () => {
    const bridge = installMockBridge({
      'dialog:pickFolder': () => 'C:\\Dev\\Shop',
      'projects:add': ({ path }) => makeSummary({ id: 'new', path }),
    });
    renderWithProviders(<AddButton />);
    await userEvent.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => expect(useUiStore.getState().selectedProjectId).toBe('new'));
    expect(bridge.callsTo('projects:add')).toEqual([{ path: 'C:\\Dev\\Shop' }]);
  });

  it('does nothing when the picker is cancelled', async () => {
    const bridge = installMockBridge({ 'dialog:pickFolder': () => null });
    renderWithProviders(<AddButton />);
    await userEvent.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => expect(bridge.callsTo('dialog:pickFolder')).toHaveLength(1));
    expect(bridge.callsTo('projects:add')).toEqual([]);
  });

  it('shows the conflict message as a toast', async () => {
    installMockBridge({
      'dialog:pickFolder': () => 'c:\\dev\\shop',
      'projects:add': () => {
        throw new NestboxError('CONFLICT', 'This folder is already added as "shop"');
      },
    });
    renderWithProviders(<AddButton />);
    await userEvent.click(screen.getByRole('button', { name: 'add' }));
    expect(await screen.findByText('This folder is already added as "shop"')).toBeInTheDocument();
  });
});

function SettingsProbe() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  return (
    <div>
      <span>tray: {data ? String(data.closeToTray) : 'loading'}</span>
      <button type="button" onClick={() => update.mutate({ closeToTray: false })}>
        off
      </button>
    </div>
  );
}

describe('settings hooks', () => {
  it('loads settings and replaces them with the saved view', async () => {
    let closeToTray = true;
    const bridge = installMockBridge({
      'settings:get': () => ({ ...AppSettingsSchema.parse({}), closeToTray, readOnly: false }),
      'settings:update': (patch) => {
        closeToTray = patch.closeToTray ?? closeToTray;
        return { ...AppSettingsSchema.parse({}), closeToTray, readOnly: false };
      },
    });
    renderWithProviders(<SettingsProbe />);
    expect(await screen.findByText('tray: true')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'off' }));
    expect(await screen.findByText('tray: false')).toBeInTheDocument();
    expect(bridge.callsTo('settings:update')).toEqual([{ closeToTray: false }]);
  });

  it('shows a read-only failure as a toast', async () => {
    installMockBridge({
      'settings:get': () => ({ ...AppSettingsSchema.parse({}), readOnly: true }),
      'settings:update': () => {
        throw new NestboxError('INTERNAL', 'Settings are read-only; changes cannot be saved');
      },
    });
    renderWithProviders(<SettingsProbe />);
    await screen.findByText('tray: true');
    await userEvent.click(screen.getByRole('button', { name: 'off' }));
    expect(await screen.findByText('Settings are read-only; changes cannot be saved')).toBeInTheDocument();
  });
});

function ChangedSubscriber() {
  useProjectsChangedSubscription();
  return null;
}

describe('useProjectsChangedSubscription', () => {
  it('invalidates projects, tool lists and tool data', () => {
    const bridge = installMockBridge({});
    const { client } = renderWithProviders(<ChangedSubscriber />);
    const spy = vi.spyOn(client, 'invalidateQueries');
    act(() => bridge.emit('projects:changed'));
    expect(spy.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([['projects'], ['tools'], ['tool']]);
  });
});
