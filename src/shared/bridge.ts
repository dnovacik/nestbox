import type { ChannelInput, ChannelOutput } from './channels';
import type { IpcEnvelope } from './errors';
import type { EventChannel, InvokeChannel } from './ipc-names';

/** The object the preload exposes as window.nestbox. */
export interface NestboxBridge {
  invoke<C extends InvokeChannel>(channel: C, input?: ChannelInput<C>): Promise<IpcEnvelope<ChannelOutput<C>>>;
  on(event: EventChannel, listener: (payload: unknown) => void): () => void;
}
