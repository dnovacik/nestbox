import { INVOKE_CHANNELS } from '@shared/ipc-names';
import type { Dispatch } from './router';

interface InvokeEventLike {
  senderFrame?: { url: string } | null;
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: InvokeEventLike, payload: unknown) => unknown): void;
}

export function registerIpc(ipcMain: IpcMainLike, dispatch: Dispatch): void {
  for (const channel of INVOKE_CHANNELS) {
    ipcMain.handle(channel, (event, payload) => dispatch(channel, event.senderFrame?.url ?? '', payload));
  }
}
