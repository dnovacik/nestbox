import type { NestboxBridge } from './bridge';
import type { ChannelInput, ChannelOutput } from './channels';
import { NestboxError } from './errors';
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
    },
    dialog: {
      pickFolder: () => call('dialog:pickFolder'),
    },
    projects: {
      list: () => call('projects:list'),
      add: (path: string) => call('projects:add', { path }),
      remove: (id: string) => call('projects:remove', { id }),
      rename: (id: string, name: string) => call('projects:rename', { id, name }),
      setPinned: (id: string, pinned: boolean) => call('projects:setPinned', { id, pinned }),
      refresh: (id: string) => call('projects:refresh', { id }),
      openInEditor: (id: string) => call('projects:openInEditor', { id }),
      openTerminal: (id: string) => call('projects:openTerminal', { id }),
    },
    processes: {
      list: () => call('processes:list'),
      stopAll: (projectId?: string) => call('processes:stopAll', projectId === undefined ? {} : { projectId }),
    },
    settings: {
      get: () => call('settings:get'),
      update: (patch: SettingsPatch) => call('settings:update', patch),
    },
    tools: {
      list: (projectId: string) => call('tools:list', { projectId }),
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
