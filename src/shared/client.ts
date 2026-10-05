import type { NestboxBridge } from './bridge';
import type { ChannelInput, ChannelOutput } from './channels';
import { NestboxError } from './errors';
import type { PortKillInput } from './ports';
import type { SettingsPatch } from './settings';
import type { EventChannel, InvokeChannel } from './ipc-names';
import type { ToolId, ToolMethodInput, ToolMethodName, ToolMethodOutput } from './tools';

export function createNestboxClient(getBridge: () => NestboxBridge) {
  async function call<C extends InvokeChannel>(channel: C, input?: ChannelInput<C>): Promise<ChannelOutput<C>> {
    const envelope = await getBridge().invoke(channel, input);
    if (envelope.ok) return envelope.data;
    throw new NestboxError(envelope.error.code, envelope.error.message);
  }

  return {
    app: {
      getInfo: () => call('app:getInfo'),
      openExternal: (url: string) => call('app:openExternal', { url }),
    },
    dialog: {
      pickFolder: () => call('dialog:pickFolder'),
    },
    projects: {
      list: () => call('projects:list'),
      add: (path: string) => call('projects:add', { path }),
      scan: (path: string) => call('projects:scan', { path }),
      addFolders: (path: string, group: string | null) => call('projects:addFolders', { path, group }),
      remove: (id: string) => call('projects:remove', { id }),
      rename: (id: string, name: string) => call('projects:rename', { id, name }),
      setPinned: (id: string, pinned: boolean) => call('projects:setPinned', { id, pinned }),
      refresh: (id: string) => call('projects:refresh', { id }),
      openInEditor: (id: string) => call('projects:openInEditor', { id }),
      openTerminal: (id: string) => call('projects:openTerminal', { id }),
      move: (id: string, groupId: string | null, beforeId: string | null) =>
        call('projects:move', { id, groupId, beforeId }),
    },
    groups: {
      list: () => call('groups:list'),
      create: (name: string) => call('groups:create', { name }),
      rename: (id: string, name: string) => call('groups:rename', { id, name }),
      delete: (id: string) => call('groups:delete', { id }),
      setCollapsed: (id: string, collapsed: boolean) => call('groups:setCollapsed', { id, collapsed }),
      move: (id: string, beforeId: string | null) => call('groups:move', { id, beforeId }),
    },
    processes: {
      list: () => call('processes:list'),
      stopAll: (projectId?: string) => call('processes:stopAll', projectId === undefined ? {} : { projectId }),
    },
    ports: {
      list: () => call('ports:list'),
      kill: (input: PortKillInput) => call('ports:kill', input),
      waitFree: (port: number, timeoutMs: number) => call('ports:waitFree', { port, timeoutMs }),
    },
    deps: {
      overview: () => call('deps:overview'),
      checkAll: () => call('deps:checkAll'),
    },
    settings: {
      get: () => call('settings:get'),
      update: (patch: SettingsPatch) => call('settings:update', patch),
    },
    tools: {
      list: (projectId: string) => call('tools:list', { projectId }),
      busy: () => call('tools:busy'),
      invoke: <T extends ToolId, M extends ToolMethodName<T>>(
        toolId: T,
        projectId: string,
        method: M,
        input: ToolMethodInput<T, M>,
      ) => call('tools:invoke', { toolId, projectId, method, input }) as Promise<ToolMethodOutput<T, M>>,
    },
    on: (event: EventChannel, listener: (payload: unknown) => void) => getBridge().on(event, listener),
  };
}

export type NestboxClient = ReturnType<typeof createNestboxClient>;
