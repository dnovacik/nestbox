import { describe, expect, it } from 'vitest';
import { createDarwinAdapter } from './darwin';
import { noopRunner } from './testing';

describe('darwin stub', () => {
  const adapter = createDarwinAdapter({ runner: noopRunner, getEditorCommand: () => 'code' });

  it('compares paths case-sensitively', () => {
    expect(adapter.samePath('/Users/me/Shop/', '/Users/me/Shop')).toBe(true);
    expect(adapter.samePath('/Users/me/Shop', '/users/me/shop')).toBe(false);
  });

  it('uses an inset title bar', () => {
    expect(adapter.windowChrome({ color: 'a', symbolColor: 'b', height: 40 })).toEqual({ titleBarStyle: 'hiddenInset' });
  });

  it('throws NOT_IMPLEMENTED for OS actions', async () => {
    await expect(adapter.openInEditor('/a')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(adapter.openTerminal('/a')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(adapter.resolveShellEnv()).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});
