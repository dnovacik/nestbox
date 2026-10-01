import { describe, expect, it, vi } from 'vitest';
import type { NestboxBridge } from './bridge';
import { createNestboxClient } from './client';
import { NestboxError } from './errors';

function bridgeReturning(envelope: unknown): NestboxBridge & { invoke: ReturnType<typeof vi.fn> } {
  return { invoke: vi.fn(async () => envelope), on: vi.fn(() => () => {}) } as never;
}

describe('nestbox client', () => {
  it('unwraps ok envelopes', async () => {
    const bridge = bridgeReturning({ ok: true, data: 'C:\\Dev\\Shop' });
    const client = createNestboxClient(() => bridge);
    expect(await client.dialog.pickFolder()).toBe('C:\\Dev\\Shop');
  });

  it('throws NestboxError with the code from error envelopes', async () => {
    const bridge = bridgeReturning({ ok: false, error: { code: 'CONFLICT', message: 'dup' } });
    const client = createNestboxClient(() => bridge);
    const error = await client.projects.add('C:\\x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NestboxError);
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'dup' });
  });

  it('builds channel payloads', async () => {
    const bridge = bridgeReturning({ ok: true, data: undefined });
    const client = createNestboxClient(() => bridge);
    await client.projects.rename('a', 'b');
    await client.tools.invoke('project-info', 'p1', 'getFacts', {});
    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'projects:rename', { id: 'a', name: 'b' });
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'tools:invoke', {
      toolId: 'project-info',
      projectId: 'p1',
      method: 'getFacts',
      input: {},
    });
  });

  it('builds port payloads', async () => {
    const bridge = bridgeReturning({ ok: true, data: undefined });
    const client = createNestboxClient(() => bridge);
    await client.ports.list();
    await client.ports.kill({ pid: 7, port: 3000, confirmed: false });
    await client.ports.waitFree(3000, 5_000);
    expect(bridge.invoke.mock.calls).toEqual([
      ['ports:list', undefined],
      ['ports:kill', { pid: 7, port: 3000, confirmed: false }],
      ['ports:waitFree', { port: 3000, timeoutMs: 5_000 }],
    ]);
  });

  it('resolves the bridge lazily', async () => {
    const holder: { bridge?: NestboxBridge } = {};
    const client = createNestboxClient(() => {
      if (!holder.bridge) throw new Error('no bridge yet');
      return holder.bridge;
    });
    holder.bridge = bridgeReturning({ ok: true, data: [] });
    expect(await client.projects.list()).toEqual([]);
  });
});
