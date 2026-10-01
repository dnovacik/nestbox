import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { app, type BrowserWindow, dialog, ipcMain, session } from 'electron';
import type { EventChannel } from '@shared/ipc-names';
import { brandAsset } from './assets';
import { detectProject } from './detection/detect-project';
import { isDirectory } from './detection/fs-utils';
import { createCoreHandlers } from './ipc/core-handlers';
import { registerIpc } from './ipc/register';
import { createRouter } from './ipc/router';
import { createConsoleLogger } from './logger';
import { spawnRunner } from './platform/command-runner';
import { createPlatformAdapter } from './platform';
import { ProjectService } from './projects/project-service';
import { buildCsp } from './security/csp';
import { applySessionSecurity } from './security/harden';
import { isAppUrl } from './security/origin';
import { createElectronStoreBackend } from './store/electron-store-backend';
import { StoreService } from './store/store-service';
import { mainTools } from './tools';
import { createSharedContext } from './tools/shared-context';
import { createToolHost } from './tools/tool-host';
import { createMainWindow } from './window';

const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  const logger = createConsoleLogger();

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => app.quit()); // M1: hide to tray when closeToTray is set

  void app.whenReady().then(async () => {
    const store = new StoreService(createElectronStoreBackend(app.getPath('userData')), logger);
    const platform = createPlatformAdapter({
      runner: spawnRunner,
      getEditorCommand: () => store.getSettings().editorCommand,
    });
    const emit = (channel: EventChannel, payload?: unknown): void => {
      mainWindow?.webContents.send(channel, payload);
    };

    const projects = new ProjectService({
      store,
      samePath: platform.samePath,
      resolvePath: (p) => resolve(p),
      isDirectory,
      detect: (input) =>
        detectProject(input, {
          onWarning: (file, reason) => logger.warn('detection skipped a file', { file, reason }),
        }),
      newId: randomUUID,
      onChanged: () => emit('projects:changed'),
    });
    await projects.init();

    const toolHost = createToolHost({
      tools: mainTools,
      getProject: (id) => projects.getDetected(id),
      shared: createSharedContext(),
      platform,
      emit: (payload) => emit('tools:event', payload),
      logger,
    });
    app.on('before-quit', () => {
      void toolHost.disposeAll();
    });

    const isTrusted = (url: string): boolean => isAppUrl(url, devServerUrl);
    const dispatch = createRouter({
      handlers: createCoreHandlers({
        projects,
        toolHost,
        platform,
        isDirectory,
        appInfo: () => ({ version: app.getVersion(), platform: platform.id }),
        pickFolder: async () => {
          const options = { properties: ['openDirectory' as const], title: 'Add project folder' };
          const result = mainWindow
            ? await dialog.showOpenDialog(mainWindow, options)
            : await dialog.showOpenDialog(options);
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
      }),
      isTrustedSender: isTrusted,
      logger,
    });
    registerIpc(ipcMain, dispatch);

    applySessionSecurity(session.defaultSession, devServerUrl ? { devCsp: buildCsp({ dev: true }) } : {});

    mainWindow = createMainWindow({
      platform,
      devServerUrl,
      isAllowedUrl: isTrusted,
      icon: brandAsset(
        { isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath },
        'png/nestbox.ico',
      ),
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });
}
