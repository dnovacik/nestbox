import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { PlatformAdapter } from './platform/adapter';
import { hardenWebContents } from './security/harden';
import { TITLE_BAR_HEIGHT, WINDOW_COLORS } from './window-theme';

export interface MainWindowOptions {
  platform: PlatformAdapter;
  devServerUrl: string | undefined;
  isAllowedUrl(url: string): boolean;
  icon: string;
}

export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: WINDOW_COLORS.background,
    icon: opts.icon,
    ...opts.platform.windowChrome({
      color: WINDOW_COLORS.titleBar,
      symbolColor: WINDOW_COLORS.titleBarSymbols,
      height: TITLE_BAR_HEIGHT,
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  hardenWebContents(win.webContents, opts.isAllowedUrl);
  win.once('ready-to-show', () => win.show());
  if (opts.devServerUrl) void win.loadURL(opts.devServerUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}
