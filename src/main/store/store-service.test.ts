import { describe, expect, it } from 'vitest';
import { defaultStoreData } from '@shared/types';
import { createMemoryLogger } from '../logger';
import { createMemoryBackend } from './backend';
import { StoreService } from './store-service';

const project = { id: 'p1', name: 'shop', path: 'C:\\Dev\\Shop', tags: [], pinned: false, runGroups: [], envProfiles: [], toolSettings: {} };

describe('StoreService', () => {
  it('initialises an empty backend with defaults and writes them', () => {
    const backend = createMemoryBackend({});
    const store = new StoreService(backend, createMemoryLogger());
    expect(store.getProjects()).toEqual([]);
    expect(backend.data).toEqual(defaultStoreData());
  });

  it('loads valid data', () => {
    const backend = createMemoryBackend({ ...defaultStoreData(), projects: [project] });
    expect(new StoreService(backend, createMemoryLogger()).getProjects()).toEqual([project]);
  });

  it('runs migrations and persists the result', () => {
    const backend = createMemoryBackend({ schemaVersion: 0, projects: [project] });
    const store = new StoreService(backend, createMemoryLogger(), {
      0: (d) => ({ ...d, settings: {} }),
    });
    expect(store.getSettings().editorCommand).toBe('code');
    expect((backend.data as { schemaVersion: number }).schemaVersion).toBe(1);
  });

  it.each([
    ['unreadable JSON', 'throw'],
    ['schema-invalid data', { schemaVersion: 1, settings: {}, projects: [{ id: 5 }] }],
    ['a newer schema version', { schemaVersion: 7, settings: {}, projects: [] }],
    ['a missing schema version', { projects: [] }],
  ])('backs up and resets on %s', (_label, initial) => {
    const backend = createMemoryBackend(initial === 'throw' ? undefined : initial);
    if (initial === 'throw') backend.read = () => { throw new SyntaxError('Unexpected token'); };
    const logger = createMemoryLogger();
    const store = new StoreService(backend, logger);
    expect(store.getProjects()).toEqual([]);
    expect(backend.backups).toBe(1);
    expect(backend.data).toEqual(defaultStoreData());
    expect(logger.entries[0]).toMatchObject({ level: 'warn', message: 'Store reset to defaults' });
  });

  it('never logs stored values when resetting', () => {
    const backend = createMemoryBackend({ schemaVersion: 1, settings: { editorCommand: 'SECRET_CMD' }, projects: 'x' });
    const logger = createMemoryLogger();
    new StoreService(backend, logger);
    expect(JSON.stringify(logger.entries)).not.toContain('SECRET_CMD');
  });

  it('validates and persists project updates', () => {
    const backend = createMemoryBackend({});
    const store = new StoreService(backend, createMemoryLogger());
    store.updateProjects((ps) => [...ps, project]);
    expect(store.getProjects()).toEqual([project]);
    expect((backend.data as { projects: unknown[] }).projects).toHaveLength(1);
    expect(() => store.updateProjects((ps) => [...ps, { ...project, id: '' }])).toThrow();
    expect(store.getProjects()).toHaveLength(1);
  });
});
