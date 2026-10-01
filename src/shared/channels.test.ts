import { describe, expect, it } from 'vitest';
import { channels } from './channels';
import { INVOKE_CHANNELS } from './ipc-names';

describe('channels', () => {
  it('defines a schema pair for every invoke channel and nothing else', () => {
    expect(Object.keys(channels).sort()).toEqual([...INVOKE_CHANNELS].sort());
  });

  it('rejects unknown keys on inputs', () => {
    expect(channels['projects:remove'].input.safeParse({ id: 'a', extra: 1 }).success).toBe(false);
  });

  it('trims and bounds names on rename', () => {
    expect(channels['projects:rename'].input.parse({ id: 'a', name: '  x  ' })).toEqual({ id: 'a', name: 'x' });
    expect(channels['projects:rename'].input.safeParse({ id: 'a', name: ' ' }).success).toBe(false);
  });

  it('accepts no payload for no-input channels', () => {
    expect(channels['projects:list'].input.safeParse(undefined).success).toBe(true);
  });

  it('bounds port inputs', () => {
    expect(channels['ports:kill'].input.safeParse({ pid: 7, port: 3000, confirmed: true }).success).toBe(true);
    expect(channels['ports:kill'].input.safeParse({ pid: 0, port: 3000, confirmed: true }).success).toBe(false);
    expect(channels['ports:kill'].input.safeParse({ pid: 7, port: 70_000, confirmed: true }).success).toBe(false);
    expect(channels['ports:waitFree'].input.safeParse({ port: 3000, timeoutMs: 60_000 }).success).toBe(false);
  });
});
