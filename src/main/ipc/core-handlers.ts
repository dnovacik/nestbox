import { splitProjectId } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { belongsTo } from '@shared/processes';
import type { AppInfo, AppSettings } from '@shared/types';
import type { PlatformAdapter } from '../platform/adapter';
import type { PortService } from '../ports/port-service';
import type { ProcessManager } from '../processes/process-manager';
import type { ProjectService } from '../projects/project-service';
import type { StoreService } from '../store/store-service';
import type { ToolHost } from '../tools/tool-host';
import type { CoreHandlers } from './router';
import type { DepsOverview } from '@shared/tools/deps/contract';

export interface CoreHandlerDeps {
  projects: Pick<
    ProjectService,
    | 'list'
    | 'add'
    | 'remove'
    | 'rename'
    | 'setPinned'
    | 'refresh'
    | 'getDetected'
    | 'moveProject'
    | 'listGroups'
    | 'createGroup'
    | 'renameGroup'
    | 'deleteGroup'
    | 'setGroupCollapsed'
    | 'moveGroup'
  >;
  toolHost: ToolHost;
  platform: Pick<PlatformAdapter, 'openInEditor' | 'openTerminal' | 'commandExists'>;
  appInfo(): AppInfo;
  /** Electron's shell.openExternal; only ever called with an http(s) URL. */
  openExternal(url: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  isDirectory(path: string): Promise<boolean>;
  processes: Pick<ProcessManager, 'list' | 'stopAll' | 'forget'>;
  settings: Pick<StoreService, 'getSettings' | 'updateSettings' | 'isReadOnly'>;
  ports: Pick<PortService, 'list' | 'kill' | 'waitUntilFree'>;
  deps: { overview(): Promise<DepsOverview>; checkAll(): void };
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
    'app:openExternal': async ({ url }) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new NestboxError('VALIDATION', 'Not a web link');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new NestboxError('VALIDATION', 'Not a web link');
      await deps.openExternal(parsed.href);
    },
    'dialog:pickFolder': () => deps.pickFolder(),
    'projects:list': () => deps.projects.list(),
    'projects:add': ({ path }) => deps.projects.add(path),
    'projects:remove': async ({ id }) => {
      // Fail the way remove() would before touching any process. An unknown id matches no process,
      // so remove() reports NOT_FOUND; detection results are not needed (they may still be loading).
      if (splitProjectId(id).relPath !== '') {
        throw new NestboxError('VALIDATION', 'Workspace packages cannot be changed individually');
      }
      const ofProject = (processProjectId: string) => belongsTo(processProjectId, id);
      await deps.processes.stopAll(ofProject);
      deps.processes.forget(ofProject);
      deps.projects.remove(id);
      deps.toolHost.forgetProject(id);
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
    'projects:move': async ({ id, groupId, beforeId }) => deps.projects.moveProject(id, groupId, beforeId),
    'groups:list': async () => deps.projects.listGroups(),
    'groups:create': async ({ name }) => deps.projects.createGroup(name),
    'groups:rename': async ({ id, name }) => deps.projects.renameGroup(id, name),
    'groups:delete': async ({ id }) => deps.projects.deleteGroup(id),
    'groups:setCollapsed': async ({ id, collapsed }) => deps.projects.setGroupCollapsed(id, collapsed),
    'groups:move': async ({ id, beforeId }) => deps.projects.moveGroup(id, beforeId),
    'tools:list': async ({ projectId }) => deps.toolHost.list(projectId),
    'tools:busy': async () => deps.toolHost.busyTools(),
    'tools:invoke': ({ toolId, projectId, method, input }) => deps.toolHost.invoke(toolId, projectId, method, input),
    'processes:list': async () => deps.processes.list(),
    'processes:stopAll': async ({ projectId }) => {
      await deps.processes.stopAll(projectId === undefined ? undefined : (p) => belongsTo(p, projectId));
    },
    'ports:list': () => deps.ports.list(),
    'ports:kill': (input) => deps.ports.kill(input),
    'ports:waitFree': ({ port, timeoutMs }) => deps.ports.waitUntilFree(port, timeoutMs),
    'deps:overview': () => deps.deps.overview(),
    'deps:checkAll': async () => {
      deps.deps.checkAll();
    },
    'settings:get': async () => settingsView(),
    'settings:update': async (patch) => {
      const editor = patch.editorCommand;
      if (editor !== undefined && editor !== deps.settings.getSettings().editorCommand) {
        // Payload values never go into messages, so the command itself is not repeated here.
        if ((await deps.platform.commandExists(editor)) === false) {
          throw new NestboxError('NOT_FOUND', 'That editor command was not found on PATH');
        }
      }
      deps.settings.updateSettings((current) => ({ ...current, ...patch }));
      deps.onSettingsChanged(deps.settings.getSettings());
      return settingsView();
    },
  };
}
