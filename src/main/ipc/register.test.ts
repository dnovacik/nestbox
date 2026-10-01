import { describe, expect, it, vi } from 'vitest';
import { INVOKE_CHANNELS } from '@shared/ipc-names';
import { registerIpc } from './register';

describe('registerIpc', () => {
  it('registers every invoke channel and forwards the sender frame url', async () => {
    const registered = new Map<string, (event: unknown, payload: unknown) => unknown>();
    const ipcMain = { handle: vi.fn((ch: string, fn: (event: unknown, payload: unknown) => unknown) => registered.set(ch, fn)) };
    const dispatch = vi.fn(async () => ({ ok: true as const, data: 1 }));
    registerIpc(ipcMain, dispatch);
    expect([...registered.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort());
    await registered.get('projects:list')?.({ senderFrame: { url: 'file:///app/index.html' } }, undefined);
    expect(dispatch).toHaveBeenCalledWith('projects:list', 'file:///app/index.html', undefined);
    await registered.get('projects:list')?.({ senderFrame: null }, undefined);
    expect(dispatch).toHaveBeenLastCalledWith('projects:list', '', undefined);
  });
});
