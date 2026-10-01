import { describe, expect, it } from 'vitest';
import { EditorCommandSchema, SettingsPatchSchema } from './settings';

describe('settings schemas', () => {
  it.each(['code', 'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd', 'cursor'])('accepts editor %s', (v) => {
    expect(EditorCommandSchema.safeParse(v).success).toBe(true);
  });

  it.each(['code"', 'a\nb', 'a\rb', 'a\0b', '', '   ', 'x'.repeat(261)])('rejects editor %j', (v) => {
    expect(EditorCommandSchema.safeParse(v).success).toBe(false);
  });

  it('rejects unknown keys and out-of-range buffers', () => {
    expect(SettingsPatchSchema.safeParse({ theme: 'light' }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ logBufferLines: 999 }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ logBufferLines: 1_000_001 }).success).toBe(false);
    expect(SettingsPatchSchema.parse({ closeToTray: false, trayIconTheme: 'auto' })).toEqual({
      closeToTray: false,
      trayIconTheme: 'auto',
    });
  });

  it('accepts up to 20 unique ports between 1 and 65535', () => {
    expect(SettingsPatchSchema.parse({ watchedPorts: [] })).toEqual({ watchedPorts: [] });
    expect(SettingsPatchSchema.parse({ watchedPorts: [1, 65535] })).toEqual({ watchedPorts: [1, 65535] });
    for (const bad of [[0], [65536], [3000, 3000], [1.5], Array.from({ length: 21 }, (_, i) => i + 1)]) {
      expect(SettingsPatchSchema.safeParse({ watchedPorts: bad }).success).toBe(false);
    }
  });
});
