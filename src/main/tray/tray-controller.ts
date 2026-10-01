import type { Menu, NativeImage, NativeTheme, Tray } from 'electron';
import type { ProcessSummary } from '@shared/processes';
import type { TrayIconTheme } from '@shared/types';
import type { Logger } from '../logger';
import {
  buildTrayMenu,
  resolveTrayTheme,
  type TrayActions,
  trayIconPaths,
  type TrayModel,
  trayState,
  trayTooltip,
} from './tray-menu';

export interface TrayElectron {
  createTray(image: NativeImage): Tray;
  buildMenu: typeof Menu.buildFromTemplate;
  imageFromPath(path: string): NativeImage;
  nativeTheme: NativeTheme;
}

export interface TrayControllerDeps {
  electron: TrayElectron;
  /** Absolute path of a file under resources/brand. */
  assetPath(relPath: string): string;
  getModel(): Promise<TrayModel>;
  getProcesses(): readonly ProcessSummary[];
  getTheme(): TrayIconTheme;
  actions: TrayActions;
  logger: Logger;
}

export interface TrayController {
  /** Rebuilds icon, tooltip and menu. Calls made during a rebuild coalesce into one more rebuild. */
  refresh(): void;
  destroy(): void;
}

/** Thin Electron wiring around the pure tray-menu helpers. */
export function createTrayController(deps: TrayControllerDeps): TrayController {
  const { electron } = deps;

  function icon(): NativeImage {
    const theme = resolveTrayTheme(deps.getTheme(), electron.nativeTheme.shouldUseDarkColors);
    const paths = trayIconPaths(theme, trayState(deps.getProcesses()));
    const image = electron.imageFromPath(deps.assetPath(paths.x1));
    image.addRepresentation({ scaleFactor: 2, buffer: electron.imageFromPath(deps.assetPath(paths.x2)).toPNG() });
    return image;
  }

  const tray = electron.createTray(icon());
  tray.on('click', () => deps.actions.show());
  tray.on('double-click', () => deps.actions.show());

  let running = false;
  let again = false;
  let destroyed = false;

  async function rebuild(): Promise<void> {
    running = true;
    try {
      do {
        again = false;
        const model = await deps.getModel();
        if (destroyed) return;
        tray.setImage(icon());
        tray.setToolTip(trayTooltip(deps.getProcesses()));
        tray.setContextMenu(electron.buildMenu(buildTrayMenu(model, deps.actions)));
      } while (again && !destroyed);
    } catch {
      deps.logger.error('tray refresh failed');
    } finally {
      running = false;
    }
  }

  const refresh = (): void => {
    if (destroyed) return;
    if (running) {
      again = true;
      return;
    }
    void rebuild();
  };

  electron.nativeTheme.on('updated', refresh);
  refresh();

  return {
    refresh,
    destroy() {
      destroyed = true;
      electron.nativeTheme.removeListener('updated', refresh);
      tray.destroy();
    },
  };
}
