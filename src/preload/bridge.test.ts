import { describe, expect, it, vi } from 'vitest';
import { createBridge, type IpcRendererLike } from './bridge';

function fakeIpc(): IpcRendererLike & { listeners: Map<string, (e: unknown, p: unknown) => void> } {
  const listeners = new Map<string, (e: unknown, p: unknown) => void>();
  return {
    listeners,
    invoke: vi.fn(async () => ({ ok: true, data: [] })),
    on: vi.fn((ch: string, l: (e: unknown, p: unknown) => void) => listeners.set(ch, l)),
    removeListener: vi.fn((ch: string) => listeners.delete(ch)),
  };
}

describe('preload bridge', () => {
  it('forwards whitelisted invokes untouched', async () => {
    const ipc = fakeIpc();
    const bridge = createBridge(ipc);
    expect(await bridge.invoke('projects:list')).toEqual({ ok: true, data: [] });
    expect(ipc.invoke).toHaveBeenCalledWith('projects:list', undefined);
  });

  it('rejects channels that are not whitelisted', async () => {
    const ipc = fakeIpc();
    const bridge = createBridge(ipc);
    await expect(bridge.invoke('fs:readFile' as never)).rejects.toThrow(/not allowed/);
    expect(ipc.invoke).not.toHaveBeenCalled();
  });

  it('subscribes to whitelisted events without leaking the IPC event object', () => {
    const ipc = fakeIpc();
    const bridge = createBridge(ipc);
    const listener = vi.fn();
    const off = bridge.on('projects:changed', listener);
    ipc.listeners.get('projects:changed')?.({ sender: 'secret' }, 42);
    expect(listener).toHaveBeenCalledWith(42);
    off();
    expect(ipc.removeListener).toHaveBeenCalled();
  });

  it('refuses non-whitelisted events', () => {
    expect(() => createBridge(fakeIpc()).on('ipc:raw' as never, () => {})).toThrow(/not allowed/);
  });
});
