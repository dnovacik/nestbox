import { NestboxError } from '@shared/errors';
import type { AppInfo, AppSettings } from '@shared/types';
import type { PlatformAdapter } from '../platform/adapter';
import type { ProjectService } from '../projects/project-service';
import type { StoreService } from '../store/store-service';
import type { ToolHost } from '../tools/tool-host';
import type { CoreHandlers } from './router';

export interface CoreHandlerDeps {
  projects: Pick<ProjectService, 'list' | 'add' | 'remove' | 'rename' | 'setPinned' | 'refresh' | 'getDetected'>;
  toolHost: ToolHost;
  platform: Pick<PlatformAdapter, 'openInEditor' | 'openTerminal'>;
  appInfo(): AppInfo;
  pickFolder(): Promise<string | null>;
  isDirectory(path: string): Promise<boolean>;
  settings: Pick<StoreService, 'getSettings' | 'updateSettings' | 'isReadOnly'>;
  /** Called after a successful settings:update (tray theme and friends react here). */
  onSettingsChanged(settings: AppSettings): void;
}

export function createCoreHandlers(deps: CoreHandlerDeps): CoreHandlers {
  /** The project folder as it exists right now — re-checked at click time, not trusted from the cache. */
  async function existingPath(id: string): Promise<string> {
    const project = deps.projects.getDetected(id);
    if (project.missing || !(await deps.isDirectory(project.path))) {
      await deps.projects.refresh(id).catch(() => undefined);
      throw new NestboxError('NOT_FOUND', 'The project folder no longer exists');
    }
    return project.path;
  }

  const settingsView = () => ({ ...deps.settings.getSettings(), readOnly: deps.settings.isReadOnly() });

  return {
    'app:getInfo': async () => deps.appInfo(),
    'dialog:pickFolder': () => deps.pickFolder(),
    'projects:list': () => deps.projects.list(),
    'projects:add': ({ path }) => deps.projects.add(path),
    'projects:remove': async ({ id }) => {
      deps.projects.remove(id);
    },
    'projects:rename': async ({ id, name }) => deps.projects.rename(id, name),
    'projects:setPinned': async ({ id, pinned }) => deps.projects.setPinned(id, pinned),
    'projects:refresh': ({ id }) => deps.projects.refresh(id),
    'projects:openInEditor': async ({ id }) => {
      await deps.platform.openInEditor(await existingPath(id));
    },
    'projects:openTerminal': async ({ id }) => {
      await deps.platform.openTerminal(await existingPath(id));
    },
    'tools:list': async ({ projectId }) => deps.toolHost.list(projectId),
    'tools:invoke': ({ toolId, projectId, method, input }) => deps.toolHost.invoke(toolId, projectId, method, input),
    'settings:get': async () => settingsView(),
    'settings:update': async (patch) => {
      deps.settings.updateSettings((current) => ({ ...current, ...patch }));
      deps.onSettingsChanged(deps.settings.getSettings());
      return settingsView();
    },
  };
}
