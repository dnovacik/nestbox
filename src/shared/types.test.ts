import { describe, expect, it } from 'vitest';
import {
  AppSettingsSchema,
  CURRENT_SCHEMA_VERSION,
  defaultStoreData,
  ProjectNameSchema,
  ProjectSchema,
  RunGroupSchema,
  StoreDataSchema,
} from './types';

describe('persisted types', () => {
  it('fills project defaults from id, name and path only', () => {
    const p = ProjectSchema.parse({ id: 'a', name: 'shop', path: 'C:\\Dev\\Shop' });
    expect(p).toEqual({
      id: 'a',
      name: 'shop',
      path: 'C:\\Dev\\Shop',
      tags: [],
      pinned: false,
      runGroups: [],
      envProfiles: [],
      toolSettings: {},
    });
  });

  it('gives stored run groups an empty compose list', () => {
    expect(RunGroupSchema.parse({ name: 'dev', entries: [{ relPath: '', script: 'dev' }] })).toEqual({
      name: 'dev',
      entries: [{ relPath: '', script: 'dev' }],
      compose: [],
    });
  });

  it('accepts compose entries with valid service names only', () => {
    const group = (services: string[]) => ({ name: 'g', entries: [], compose: [{ relPath: '', services }] });
    expect(RunGroupSchema.safeParse(group([])).success).toBe(true);
    expect(RunGroupSchema.safeParse(group(['db', 'redis_1'])).success).toBe(true);
    expect(RunGroupSchema.safeParse(group(['--volumes'])).success).toBe(false);
    expect(RunGroupSchema.safeParse(group(['a b'])).success).toBe(false);
    const many = { name: 'g', entries: [], compose: Array.from({ length: 21 }, (_, i) => ({ relPath: `p${i}`, services: [] })) };
    expect(RunGroupSchema.safeParse(many).success).toBe(false);
  });

  it('keeps path casing exactly as given', () => {
    expect(ProjectSchema.parse({ id: 'a', name: 'x', path: 'C:\\Dev\\MixedCase' }).path).toBe('C:\\Dev\\MixedCase');
  });

  it('trims project names and rejects empty or over-long ones', () => {
    expect(ProjectNameSchema.parse('  shop  ')).toBe('shop');
    expect(ProjectNameSchema.safeParse('   ').success).toBe(false);
    expect(ProjectNameSchema.safeParse('x'.repeat(101)).success).toBe(false);
  });

  it('has sensible app setting defaults', () => {
    expect(AppSettingsSchema.parse({})).toEqual({
      theme: 'system',
      editorCommand: 'code',
      terminalApp: 'auto',
      logBufferLines: 50_000,
      closeToTray: true,
      trayIconTheme: 'dark-taskbar',
      watchedPorts: [3000, 5173, 5432, 6379, 8080],
    });
  });

  it('default store data is valid and versioned', () => {
    const d = defaultStoreData();
    expect(d.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(StoreDataSchema.parse(d)).toEqual(d);
  });

  it('rejects store data with a different schemaVersion', () => {
    expect(StoreDataSchema.safeParse({ ...defaultStoreData(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 }).success).toBe(false);
  });
});
