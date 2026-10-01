import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, type BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, session, shell, Tray } from 'electron';
import { splitProjectId } from '@shared/detected';
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
import { applySessionSecurity, hardenAllWebContents } from './security/harden';
import { isAppUrl } from './security/origin';
import { createElectronStoreBackend } from './store/electron-store-backend';
import { StoreService } from './store/store-service';
import { createPidLedger } from './processes/pid-ledger';
import { ProcessManager } from './processes/process-manager';
import { PortService } from './ports/port-service';
import { throttle } from './processes/throttle';
import { createMainTools } from './tools';
import { createEnvFileAccess } from './tools/env/env-files';
import { ENV_FILE_PATTERN } from './detection/detect-project';
import { createSharedContext } from './tools/shared-context';
import { createToolHost } from './tools/tool-host';
import { handleOrphans } from './lifecycle/orphan-prompt';
import { createQuitController, SHUTDOWN_TIMEOUT_MS } from './lifecycle/quit-controller';
import { crashNotice } from './tray/crash-notifier';
import { createTrayController, type TrayController } from './tray/tray-controller';
import { buildTrayModel, type TrayActions } from './tray/tray-menu';
import { createMainWindow } from './window';

const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];

// End-to-end tests run against an isolated profile. Only honoured unpackaged, and before the
// single-instance lock, which is keyed on the userData folder.
const userDataOverride = app.isPackaged ? undefined : process.env['NESTBOX_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  const logger = createConsoleLogger();

  /** Brings the window back from the tray, the taskbar or behind other windows. */
  const showWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  app.on('second-instance', showWindow);

  // Closing the window hides it or runs the quit flow (quit controller); never quit implicitly.
  app.on('window-all-closed', () => {});

  void app.whenReady().then(() => {
    const store = new StoreService(createElectronStoreBackend(app.getPath('userData')), logger);
    const platform = createPlatformAdapter({
      runner: spawnRunner,
      getEditorCommand: () => store.getSettings().editorCommand,
    });
    /** False until the renderer has loaded, and again after its process died (until the reload finishes). */
    let rendererReady = false;
    const emit = (channel: EventChannel, payload?: unknown): void => {
      if (!rendererReady || !mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
      mainWindow.webContents.send(channel, payload);
    };
    let tray: TrayController | null = null;
    const refreshTray = throttle(() => tray?.refresh(), 250);

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
      onChanged: () => {
        emit('projects:changed');
        refreshTray();
      },
      logger,
    });
    // Not awaited: the window opens while detection runs; projects:list joins the in-flight work.
    void projects.init();

    const ledger = createPidLedger(join(app.getPath('userData'), 'processes.json'), logger);
    const processes = new ProcessManager({
      platform,
      ledger,
      bufferLines: () => store.getSettings().logBufferLines,
      logger,
    });
    const notifyProcesses = throttle(() => emit('processes:changed'), 100);
    processes.on((event) => {
      if (event.type === 'changed') notifyProcesses();
    });

    const ports = new PortService({ platform, processes, ownPid: process.pid, now: Date.now, logger });

    const shared = createSharedContext();
    const tools = createMainTools({
      scripts: {
        processes,
        runGroups: {
          get: (rootId) => projects.getRunGroups(rootId),
          set: (rootId, groups) => projects.setRunGroups(rootId, groups),
        },
        getDetected: (id) => projects.getDetected(id),
        shared,
        saveFile: async (defaultName) => {
          const options = {
            defaultPath: join(app.getPath('downloads'), defaultName),
            filters: [{ name: 'Log', extensions: ['log', 'txt'] }],
          };
          const result = mainWindow
            ? await dialog.showSaveDialog(mainWindow, options)
            : await dialog.showSaveDialog(options);
          return result.canceled || !result.filePath ? null : result.filePath;
        },
        writeFile: (path, text) => writeFile(path, text, 'utf8'),
        isFile: async (path) => {
          try {
            return (await stat(path)).isFile();
          } catch {
            return false;
          }
        },
        emit: (projectId, event, payload) => emit('tools:event', { toolId: 'scripts', projectId, event, payload }),
        logger,
      },
      env: {
        files: createEnvFileAccess(),
        clipboard: { writeText: (text) => clipboard.writeText(text) },
        watch: (dir, onChange) => {
          try {
            const watcher = watch(dir, { persistent: false }, (_event, name) => {
              if (name === null || ENV_FILE_PATTERN.test(String(name))) onChange(name === null ? null : String(name));
            });
            watcher.on('error', () => watcher.close());
            return () => watcher.close();
          } catch {
            // A folder that can't be watched still works; the panel refreshes after its own edits.
            return null;
          }
        },
        logger,
      },
    });
    const toolHost = createToolHost({
      tools,
      getProject: (id) => projects.getDetectedAsync(id),
      shared,
      platform,
      emit: (payload) => emit('tools:event', payload),
      logger,
      toolSettings: {
        get: (rootId, toolId) => projects.getToolSettings(rootId, toolId),
        set: (rootId, toolId, value) => projects.setToolSettings(rootId, toolId, value),
      },
    });
    const assetEnv = { isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath };

    /** "shop" for a root, "shop · api" for a workspace package. Names only, never paths. */
    const projectLabel = (projectId: string): string | null => {
      const { rootId, relPath } = splitProjectId(projectId);
      const root = store.getProjects().find((p) => p.id === rootId);
      if (!root) return null;
      if (relPath === '') return root.name;
      let name = relPath.split('/').at(-1) ?? relPath;
      try {
        name = projects.getDetected(projectId).name;
      } catch {
        // not detected yet: the folder name will do
      }
      return `${root.name} · ${name}`;
    };

    const quitController = createQuitController({
      liveCount: () => processes.liveCount(),
      confirmQuit: async (n) => {
        const options = {
          type: 'question' as const,
          buttons: ['Stop and quit', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          message: `Stop ${n} running ${n === 1 ? 'script' : 'scripts'} and quit?`,
          detail: 'NestBox stops the scripts it started before quitting.',
        };
        const result = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
        return result.response === 0;
      },
      shutdown: async () => {
        const [, disposed] = await Promise.allSettled([processes.stopAll(), toolHost.disposeAll(SHUTDOWN_TIMEOUT_MS - 500)]);
        if (disposed.status === 'fulfilled' && disposed.value.failed.length + disposed.value.timedOut.length > 0) {
          logger.warn('tools did not dispose cleanly', {
            failed: disposed.value.failed.join(','),
            timedOut: disposed.value.timedOut.join(','),
          });
        }
        // No ledger.clear(): each process removes its own entry when it closes. Entries that remain belong to
        // trees that did not exit (or to the previous session, not yet answered) and are offered next start.
      },
      quit: () => app.quit(),
      // Without a tray icon a hidden window could not be brought back, so closing quits instead.
      closeToTray: () => tray !== null && store.getSettings().closeToTray,
      hideWindow: () => mainWindow?.hide(),
      logger,
    });
    app.on('before-quit', (event) => quitController.onBeforeQuit(event));

    const showLogs = (projectId: string, script: string): void => {
      showWindow();
      emit('app:navigate', { projectId, tab: 'scripts', script });
    };

    const trayActions: TrayActions = {
      show: showWindow,
      quit: () => void quitController.requestQuit(),
      stop: (projectId, script) => void processes.stop(projectId, script).catch(() => undefined),
      restart: (projectId, script) =>
        void processes.restartExisting(projectId, script).catch(() => logger.warn('tray restart failed', { script })),
      showLogs,
      startRunGroup: (rootId, name) =>
        void toolHost.invoke('scripts', rootId, 'startRunGroup', { name }).catch(() => logger.warn('tray run group failed')),
      openInEditor: (rootId) => {
        const open = async () => platform.openInEditor(projects.getDetected(rootId).path);
        open().catch((error: unknown) =>
          dialog.showErrorBox('Could not open the editor', error instanceof Error ? error.message : 'Unexpected error'),
        );
      },
    };

    const entryFileUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href;
    const isTrusted = (url: string): boolean => isAppUrl(url, { devServerUrl, entryFileUrl });
    const dispatch = createRouter({
      handlers: createCoreHandlers({
        projects,
        toolHost,
        platform,
        isDirectory,
        settings: store,
        processes,
        ports,
        onSettingsChanged: () => tray?.refresh(),
        appInfo: () => ({ version: app.getVersion(), platform: platform.id }),
        openExternal: (url) => shell.openExternal(url),
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

    hardenAllWebContents(app, isTrusted);
    applySessionSecurity(session.defaultSession, devServerUrl ? { devCsp: buildCsp({ dev: true }) } : {});

    mainWindow = createMainWindow({
      platform,
      devServerUrl,
      icon: brandAsset(assetEnv, 'png/nestbox.ico'),
      onQuitShortcut: () => void quitController.requestQuit(),
    });
    mainWindow.webContents.on('did-finish-load', () => {
      rendererReady = true;
    });
    // A renderer killed from Task Manager (or crashed) is reloaded; scripts keep running in main meanwhile.
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      rendererReady = false;
      logger.warn('renderer process gone', { reason: details.reason, exitCode: details.exitCode });
      if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    });
    mainWindow.on('close', (event) => quitController.onWindowClose(event));
    mainWindow.on('session-end', () => quitController.onSessionEnd());
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    // Everything below is independent of the window and of each other: a failure is logged, not fatal.
    const appId = platform.notificationAppId();
    if (appId) app.setAppUserModelId(appId);

    try {
      tray = createTrayController({
        electron: {
          createTray: (image) => new Tray(image),
          buildMenu: (template) => Menu.buildFromTemplate(template),
          imageFromPath: (path) => nativeImage.createFromPath(path),
          nativeTheme,
        },
        assetPath: (rel) => brandAsset(assetEnv, rel),
        getModel: async () =>
          buildTrayModel(await projects.list(), processes.list(), (rootId) => projects.getRunGroups(rootId)),
        getProcesses: () => processes.list(),
        getTheme: () => store.getSettings().trayIconTheme,
        actions: trayActions,
        logger,
      });
    } catch {
      logger.error('tray unavailable');
    }
    processes.on((event) => {
      if (event.type === 'changed') refreshTray();
      if (event.type !== 'crashed' || !event.final || !Notification.isSupported()) return;
      const label = projectLabel(event.summary.projectId) ?? 'a removed project';
      const notification = new Notification({
        ...crashNotice(event.summary, label),
        icon: brandAsset(assetEnv, 'png/app-icon-64.png'),
      });
      notification.on('click', () => showLogs(event.summary.projectId, event.summary.script));
      notification.show();
    });

    mainWindow.once('ready-to-show', () => {
      void handleOrphans({
        ledger,
        listProcesses: () => platform.listProcesses(),
        killTree: (pid) => platform.killTree(pid),
        projectLabel,
        ask: async (message, detail) => {
          const options = {
            type: 'warning' as const,
            buttons: ['Stop them', 'Leave running'],
            defaultId: 0,
            cancelId: 1,
            message,
            detail,
          };
          const result = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
          return result.response === 0;
        },
        logger,
      });
    });
  });
}
