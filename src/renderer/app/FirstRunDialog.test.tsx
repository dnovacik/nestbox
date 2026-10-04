import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SettingsPatch } from '@shared/settings';
import { TOGGLEABLE_TOOLS } from '@shared/tools';
import { AppSettingsSchema } from '@shared/types';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { FirstRunDialog } from './FirstRunDialog';

function setup(toolsChosen: boolean, readOnly = false) {
  let view = { ...AppSettingsSchema.parse({}), toolsChosen, readOnly };
  const patches: SettingsPatch[] = [];
  installMockBridge({
    'settings:get': () => view,
    'settings:update': (patch) => {
      patches.push(patch);
      view = { ...view, ...patch };
      return view;
    },
  });
  renderWithProviders(<FirstRunDialog />);
  return patches;
}

describe('FirstRunDialog', () => {
  it('lets a new install start with the Essentials preset', async () => {
    const patches = setup(false);
    const dialog = await screen.findByRole('dialog', { name: 'Welcome to NestBox' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Essentials' }));
    expect(within(dialog).getByRole('switch', { name: 'Git' })).toBeChecked();
    expect(within(dialog).getByRole('switch', { name: 'Static' })).not.toBeChecked();
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Static' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start with these tools' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]?.toolsChosen).toBe(true);
    expect(patches[0]?.disabledTools).not.toContain('static');
    expect(patches[0]?.disabledTools).not.toContain('git');
    expect(patches[0]?.disabledTools).toContain('inspector');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('can keep everything or just the core', async () => {
    const patches = setup(false);
    const dialog = await screen.findByRole('dialog', { name: 'Welcome to NestBox' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Just the core' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start with these tools' }));
    await waitFor(() =>
      expect(patches[0]?.disabledTools).toEqual(TOGGLEABLE_TOOLS.map((t) => t.id)),
    );
  });

  it('stays closed once chosen, and for a read-only store', async () => {
    setup(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cannot be dismissed with Escape', async () => {
    setup(false);
    await screen.findByRole('dialog', { name: 'Welcome to NestBox' });
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Welcome to NestBox' })).toBeInTheDocument();
  });
});
