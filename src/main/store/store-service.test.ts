import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, defaultStoreData } from '@shared/types';
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

  it('fills watchedPorts for a v2 store written before M2, without a migration', () => {
    const v2 = {
      schemaVersion: 2,
      settings: { theme: 'system', editorCommand: 'code', terminalApp: 'auto', logBufferLines: 50_000, closeToTray: true, trayIconTheme: 'auto' },
      projects: [project],
    };
    const store = new StoreService(createMemoryBackend(v2), createMemoryLogger());
    expect(store.getSettings().watchedPorts).toEqual([3000, 5173, 5432, 6379, 8080]);
    expect(store.isReadOnly()).toBe(false);
  });

  it('runs migrations and persists the result', () => {
    const backend = createMemoryBackend({ schemaVersion: 0, projects: [project] });
    const store = new StoreService(backend, createMemoryLogger(), {
      0: (d) => ({ ...d, settings: {} }),
      1: (d) => d,
    });
    expect(store.getSettings().editorCommand).toBe('code');
    expect((backend.data as { schemaVersion: number }).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it.each([
    ['unreadable JSON', 'throw'],
    ['schema-invalid data', { schemaVersion: 1, settings: {}, projects: [{ id: 5 }] }],
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

  it('keeps a transiently unreadable file untouched and goes read-only', () => {
    const backend = createMemoryBackend({ ...defaultStoreData(), projects: [project] });
    backend.read = () => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    };
    let writes = 0;
    const write = backend.write;
    backend.write = (d) => {
      writes++;
      write(d);
    };
    const logger = createMemoryLogger();
    const store = new StoreService(backend, logger);
    expect(store.getProjects()).toEqual([]);
    expect(backend.backups).toBe(0);
    expect(writes).toBe(0);
    expect(logger.entries[0]).toMatchObject({
      level: 'warn',
      message: 'Store unavailable, running read-only',
      fields: { reason: 'unavailable', code: 'EBUSY' },
    });
    expect(() => store.updateProjects((ps) => [...ps, project])).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
    expect(writes).toBe(0);
  });

  it('survives a failing backup, keeps defaults in memory and goes read-only', () => {
    const backend = createMemoryBackend({ schemaVersion: 1, settings: {}, projects: [{ id: 5 }] });
    backend.backupCorrupt = () => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    };
    let writes = 0;
    backend.write = () => {
      writes++;
    };
    const logger = createMemoryLogger();
    const store = new StoreService(backend, logger);
    expect(store.getProjects()).toEqual([]);
    expect(writes).toBe(0);
    expect(logger.entries[0]).toMatchObject({
      level: 'warn',
      message: 'Store unavailable, running read-only',
      fields: { reason: 'invalid', code: 'EPERM' },
    });
    expect(logger.entries.some((e) => e.message === 'Store reset to defaults')).toBe(false);
    expect(() => store.updateProjects((ps) => [...ps, project])).toThrow(
      expect.objectContaining({ code: 'INTERNAL' }),
    );
  });

  describe('read-only mode', () => {
    it('opens a newer schema read-only without backing it up', () => {
      const newer = { ...defaultStoreData(), schemaVersion: CURRENT_SCHEMA_VERSION + 1, projects: [project] };
      const backend = createMemoryBackend(structuredClone(newer));
      const logger = createMemoryLogger();
      const store = new StoreService(backend, logger);
      expect(store.isReadOnly()).toBe(true);
      expect(backend.backups).toBe(0);
      expect(store.getProjects()).toEqual([project]);
      expect(logger.entries[0]).toMatchObject({ message: 'Store unavailable, running read-only', fields: { reason: 'newer-schema' } });
      expect(() => store.updateSettings((st) => ({ ...st, closeToTray: false }))).toThrow(/read-only/);
      expect(backend.data).toEqual(newer);
    });

    it('falls back to defaults read-only when a newer file does not parse', () => {
      const backend = createMemoryBackend({ schemaVersion: 99, projects: 'nope' });
      const store = new StoreService(backend, createMemoryLogger());
      expect(store.isReadOnly()).toBe(true);
      expect(store.getProjects()).toEqual([]);
      expect(backend.backups).toBe(0);
    });

    it('goes read-only when writing fresh defaults fails', () => {
      const backend = createMemoryBackend(undefined);
      backend.write = () => {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      };
      const logger = createMemoryLogger();
      const store = new StoreService(backend, logger);
      expect(store.isReadOnly()).toBe(true);
      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          message: 'Store unavailable, running read-only',
          fields: { reason: 'write-defaults', code: 'EPERM' },
        }),
      );
    });

    it('goes read-only when writing after a backup fails', () => {
      const backend = createMemoryBackend({ schemaVersion: 1, settings: {}, projects: [{ id: 5 }] });
      backend.write = () => {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      };
      const store = new StoreService(backend, createMemoryLogger());
      expect(backend.backups).toBe(1);
      expect(store.isReadOnly()).toBe(true);
    });

    it('is writable in the normal case', () => {
      expect(new StoreService(createMemoryBackend({}), createMemoryLogger()).isReadOnly()).toBe(false);
    });
  });

  describe('updateSettings', () => {
    it('validates and persists', () => {
      const backend = createMemoryBackend({});
      const store = new StoreService(backend, createMemoryLogger());
      store.updateSettings((st) => ({ ...st, closeToTray: false }));
      expect(store.getSettings().closeToTray).toBe(false);
      expect((backend.data as { settings: { closeToTray: boolean } }).settings.closeToTray).toBe(false);
    });

    it('rejects invalid settings and leaves state untouched', () => {
      const store = new StoreService(createMemoryBackend({}), createMemoryLogger());
      expect(() => store.updateSettings((st) => ({ ...st, logBufferLines: 5 }))).toThrow();
      expect(store.getSettings().logBufferLines).toBe(50_000);
    });
  });
});
