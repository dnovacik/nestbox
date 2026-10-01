import type { NestboxBridge } from '@shared/bridge';
import { isEventChannel, isInvokeChannel } from '@shared/ipc-names';

type Listener = (event: unknown, ...args: unknown[]) => void;

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: Listener): unknown;
  removeListener(channel: string, listener: Listener): unknown;
}

export function createBridge(ipc: IpcRendererLike): NestboxBridge {
  const invoke = (channel: string, input?: unknown): Promise<unknown> => {
    if (!isInvokeChannel(channel)) {
      return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    }
    return ipc.invoke(channel, input);
  };

  return {
    invoke: invoke as unknown as NestboxBridge['invoke'],
    on(event, listener) {
      if (!isEventChannel(event)) throw new Error(`Event not allowed: ${String(event)}`);
      const wrapped: Listener = (_event, payload) => listener(payload);
      ipc.on(event, wrapped);
      return () => {
        ipc.removeListener(event, wrapped);
      };
    },
  };
}
