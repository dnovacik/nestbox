import { describe, expect, it } from 'vitest';
import { type StoreData, StoreDataSchema } from '@shared/types';
import { createMemoryLogger } from '../logger';
import { createMemoryBackend } from './backend';
import v1 from './fixtures/v1-store.json';
import { MIGRATIONS, migrate, MigrationError, NewerSchemaError } from './migrations';
import { StoreService } from './store-service';

describe('migrate', () => {
  it('returns data unchanged when already at the target version', () => {
    const raw = { schemaVersion: 1, settings: {}, projects: [] };
    expect(migrate(raw, 1, {})).toEqual(raw);
  });

  it('applies migrations step by step and bumps schemaVersion', () => {
    const table = {
      0: (d: Record<string, unknown>) => ({ ...d, settings: {} }),
      1: (d: Record<string, unknown>) => ({ ...d, projects: [] }),
    };
    expect(migrate({ schemaVersion: 0 }, 2, table)).toEqual({ schemaVersion: 2, settings: {}, projects: [] });
  });

  it.each([
    ['a non-object', [1, 2]],
    ['a missing version', { projects: [] }],
  ])('rejects %s', (_label, raw) => {
    expect(() => migrate(raw, 1, {})).toThrow(MigrationError);
  });

  it('rejects a newer version with NewerSchemaError', () => {
    expect(() => migrate({ schemaVersion: 9 }, 1, {})).toThrow(NewerSchemaError);
  });

  it('rejects a gap in the migration table', () => {
    expect(() => migrate({ schemaVersion: 0 }, 2, { 0: (d) => d })).toThrow(/No migration from v1/);
  });
});

describe('migration v1 → v2', () => {
  const fixture = (): Record<string, unknown> => structuredClone(v1) as Record<string, unknown>;

  it('adds trayIconTheme and converts run groups to entries', () => {
    const out = migrate(fixture(), 2) as StoreData;
    expect(out.schemaVersion).toBe(2);
    expect(out.settings.trayIconTheme).toBe('dark-taskbar');
    expect(out.projects[0]?.runGroups).toEqual([
      { name: 'dev', entries: [{ relPath: '', script: 'api' }, { relPath: '', script: 'web' }] },
    ]);
    expect(out.projects[1]?.runGroups).toEqual([]);
    expect(StoreDataSchema.safeParse(out).success).toBe(true);
  });

  it('keeps an existing trayIconTheme', () => {
    const raw = fixture();
    raw['settings'] = { ...(raw['settings'] as object), trayIconTheme: 'auto' };
    expect((migrate(raw, 2) as StoreData).settings.trayIconTheme).toBe('auto');
  });

  it('drops malformed run groups instead of failing the store', () => {
    const step = MIGRATIONS[1];
    if (!step) throw new Error('missing v1 migration');
    const out = step({
      settings: {},
      projects: [
        { id: 'a', runGroups: 'x' },
        { id: 'b', runGroups: [{ name: 'g', scripts: 'nope' }, { name: 'h', scripts: ['ok', 5, ''] }, 7] },
        'not-a-project',
      ],
    });
    expect(out['projects']).toEqual([
      { id: 'a', runGroups: [] },
      { id: 'b', runGroups: [{ name: 'h', entries: [{ relPath: '', script: 'ok' }] }] },
      'not-a-project',
    ]);
  });

  it('fits v1 groups into the v2 limits instead of resetting the store', () => {
    const raw = fixture();
    const projects = raw['projects'] as Record<string, unknown>[];
    const first = projects[0];
    if (!first) throw new Error('fixture has no project');
    first['runGroups'] = [
      { name: `  ${'n'.repeat(80)}  `, scripts: Array.from({ length: 60 }, (_, i) => `s${i}`) },
      { name: '   ', scripts: ['a'] },
      { name: 'long script', scripts: ['x'.repeat(201), 'ok'] },
    ];
    const out = migrate(raw, 2) as StoreData;
    expect(StoreDataSchema.safeParse(out).success).toBe(true);
    const groups = out.projects[0]?.runGroups ?? [];
    expect(groups.map((g) => g.name)).toEqual(['n'.repeat(60), 'long script']);
    expect(groups[0]?.entries).toHaveLength(50);
    expect(groups[1]?.entries).toEqual([{ relPath: '', script: 'ok' }]);
  });

  it('migrates a v1 file end to end through StoreService', () => {
    const backend = createMemoryBackend(fixture());
    const store = new StoreService(backend, createMemoryLogger());
    expect(store.isReadOnly()).toBe(false);
    expect((backend.data as StoreData).schemaVersion).toBe(2);
    expect(store.getProjects()).toHaveLength(2);
  });
});
