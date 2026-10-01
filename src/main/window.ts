import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { PlatformAdapter } from './platform/adapter';
import { TITLE_BAR_OVERLAY_HEIGHT, WINDOW_COLORS } from './window-theme';

export interface MainWindowOptions {
  platform: PlatformAdapter;
  devServerUrl: string | undefined;
  icon: string;
  /** Ctrl+Q (⌘Q on macOS) inside the window. */
  onQuitShortcut(): void;
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
      height: TITLE_BAR_OVERLAY_HEIGHT,
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
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      opts.onQuitShortcut();
    }
  });
  if (opts.devServerUrl) void win.loadURL(opts.devServerUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}
