// The macOS application menu, as a pure template (index.ts builds it with Menu.buildFromTemplate). Without
// the Edit roles, ⌘C and ⌘V do nothing in text fields. Quit goes through the quit controller, so running
// scripts are confirmed and stopped first. Windows keeps Electron's default (hidden by the frameless title bar).
import type { MenuItemConstructorOptions } from 'electron';

export interface AppMenuOptions {
  appName: string;
  isDev: boolean;
  actions: { settings(): void; quit(): void };
}

export function appMenuTemplate({ appName, isDev, actions }: AppMenuOptions): MenuItemConstructorOptions[] {
  const sep: MenuItemConstructorOptions = { type: 'separator' };
  return [
    {
      label: appName,
      submenu: [
        { role: 'about', label: `About ${appName}` },
        sep,
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => actions.settings() },
        sep,
        { role: 'hide', label: `Hide ${appName}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        sep,
        { label: `Quit ${appName}`, accelerator: 'Cmd+Q', click: () => actions.quit() },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, sep, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [...(isDev ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, sep] : []), { role: 'togglefullscreen' }],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, sep, { role: 'close' }, sep, { role: 'front' }],
    },
  ];
}
