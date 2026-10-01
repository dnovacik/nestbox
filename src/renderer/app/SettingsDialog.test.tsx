import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { SettingsPatch } from '@shared/settings';
import { AppSettingsSchema } from '@shared/types';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { SettingsDialog } from './SettingsDialog';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

function setup(readOnly = false, update?: (patch: SettingsPatch) => unknown) {
  let view = { ...AppSettingsSchema.parse({}), readOnly };
  const bridge = installMockBridge({
    'app:getInfo': () => ({ version: '1.0.0', platform: 'win32' }),
    'settings:get': () => view,
    'settings:update': (patch) => {
      if (update) update(patch);
      view = { ...view, ...patch };
      return view;
    },
  });
  renderWithProviders(
    <>
      <TitleBar node={null} />
      <SettingsDialog />
      <StatusBar projectCount={0} />
    </>,
  );
  return bridge;
}

async function open() {
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  return screen.findByRole('dialog', { name: 'Settings' });
}

describe('SettingsDialog', () => {
  it('opens from the title bar with the current values', async () => {
    setup();
    const dialog = await open();
    expect(await within(dialog).findByRole('switch', { name: 'Close to tray' })).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Tray icon theme' })).toHaveTextContent('Dark taskbar');
    expect(within(dialog).getByRole('spinbutton', { name: 'Log buffer' })).toHaveValue(50000);
    expect(within(dialog).getByRole('textbox', { name: 'Editor command' })).toHaveValue('code');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves only the changed fields and closes', async () => {
    const bridge = setup();
    const dialog = await open();
    await userEvent.click(await within(dialog).findByRole('switch', { name: 'Close to tray' }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Tray icon theme' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Automatic' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bridge.callsTo('settings:update')).toEqual([{ closeToTray: false, trayIconTheme: 'auto' }]);
  });

  it('validates the buffer size and the editor command', async () => {
    setup();
    const dialog = await open();
    const buffer = await within(dialog).findByRole('spinbutton', { name: 'Log buffer' });
    await userEvent.clear(buffer);
    await userEvent.type(buffer, '999');
    expect(within(dialog).getByText('Between 1 000 and 1 000 000 lines')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(buffer);
    await userEvent.type(buffer, '2000');
    const editor = within(dialog).getByRole('textbox', { name: 'Editor command' });
    await userEvent.type(editor, '"');
    expect(within(dialog).getByText('Quotes are not allowed')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('edits the watched ports as a comma-separated list', async () => {
    const bridge = setup();
    const dialog = await open();
    const input = await within(dialog).findByRole('textbox', { name: 'Watched ports' });
    expect(input).toHaveValue('3000, 5173, 5432, 6379, 8080');
    await userEvent.clear(input);
    await userEvent.type(input, '3000, 70000');
    expect(within(dialog).getByText('Ports between 1 and 65535, separated by commas')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '4200,3000 , 4200');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bridge.callsTo('settings:update')).toEqual([{ watchedPorts: [4200, 3000] }]);
  });

  it('is read-only with a note, and the status bar warns', async () => {
    setup(true);
    expect(await screen.findByText('Settings are read-only')).toBeInTheDocument();
    const dialog = await open();
    expect(await within(dialog).findByText(/read-only because the settings file/)).toBeInTheDocument();
    expect(within(dialog).getByRole('switch', { name: 'Close to tray' })).toBeDisabled();
    expect(within(dialog).getByRole('textbox', { name: 'Editor command' })).toBeDisabled();
  });

  it('keeps the dialog open and toasts a failed save', async () => {
    setup(false, () => {
      throw new NestboxError('INTERNAL', 'Settings are read-only; changes cannot be saved');
    });
    const dialog = await open();
    await userEvent.click(await within(dialog).findByRole('switch', { name: 'Close to tray' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Settings are read-only; changes cannot be saved')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });
});
