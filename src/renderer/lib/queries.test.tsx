import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NestboxError } from '@shared/errors';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge } from '@/test/mock-bridge';
import { makeSummary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { useAddProject } from './queries';

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
