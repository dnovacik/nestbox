import type { NestboxBridge } from '@shared/bridge';
import type { ChannelInput, ChannelOutput } from '@shared/channels';
import { type IpcEnvelope, NestboxError } from '@shared/errors';
import type { EventChannel, InvokeChannel } from '@shared/ipc-names';

export type MockHandlers = {
  [C in InvokeChannel]?: (input: ChannelInput<C>) => ChannelOutput<C> | Promise<ChannelOutput<C>>;
};

export interface MockBridge {
  calls: { channel: InvokeChannel; input: unknown }[];
  callsTo(channel: InvokeChannel): unknown[];
  emit(event: EventChannel, payload?: unknown): void;
}

export function installMockBridge(handlers: MockHandlers): MockBridge {
  const calls: MockBridge['calls'] = [];
  const listeners = new Map<EventChannel, Set<(payload: unknown) => void>>();

  const invoke = async (channel: InvokeChannel, input?: unknown): Promise<IpcEnvelope<unknown>> => {
    calls.push({ channel, input });
    const handler = handlers[channel] as ((i: unknown) => unknown) | undefined;
    if (!handler) return { ok: false, error: { code: 'NOT_FOUND', message: `No mock for ${channel}` } };
    try {
      return { ok: true, data: await handler(input) };
    } catch (error) {
      if (error instanceof NestboxError) return { ok: false, error: { code: error.code, message: error.message } };
      throw error;
    }
  };

  const bridge: NestboxBridge = {
    invoke: invoke as unknown as NestboxBridge['invoke'],
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    },
  };
  window.nestbox = bridge;

  return {
    calls,
    callsTo: (channel) => calls.filter((c) => c.channel === channel).map((c) => c.input),
    emit: (event, payload) => listeners.get(event)?.forEach((l) => l(payload)),
  };
}
