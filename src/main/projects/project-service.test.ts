import { describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import type { DetectInput } from '../detection/detect-project';
import { createMemoryLogger } from '../logger';
import { createWin32Adapter } from '../platform/win32';
import { createMemoryBackend } from '../store/backend';
import { StoreService } from '../store/store-service';
import { ProjectService } from './project-service';
import { noopRunner } from '../platform/testing';

const win32 = createWin32Adapter({ runner: noopRunner, getEditorCommand: () => 'code' });

function fakeDetect(input: DetectInput): DetectedProject {
  const folder = input.path.split('\\').pop() ?? input.path;
  return {
    id: input.id,
    rootId: input.id,
    path: input.path,
    relPath: '',
    name: input.name ?? folder.toLowerCase(),
    missing: false,
    packageJson: null,
    packageManager: 'pnpm',
    envFiles: [],
    workspaces: [
      { ...emptyDetected(), id: `${input.id}::packages/api`, rootId: input.id, relPath: 'packages/api', name: 'api', path: `${input.path}\\packages\\api` },
    ],
    prismaSchema: null,
    dockerCompose: null,
    git: null,
    buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
  };
}

function emptyDetected(): DetectedProject {
  return {
    id: 'x', rootId: 'x', path: 'x', relPath: '', name: 'x', missing: false, packageJson: null,
    packageManager: null, envFiles: [], workspaces: [], prismaSchema: null, dockerCompose: null,
    git: null, buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
  };
}

function setup(initial?: unknown) {
  const backend = createMemoryBackend(initial ?? {});
  const logger = createMemoryLogger();
  const store = new StoreService(backend, logger);
  let n = 0;
  const onChanged = vi.fn();
  const detect = vi.fn(async (input: DetectInput) => fakeDetect(input));
  const isDirectory = vi.fn(async () => true);
  const service = new ProjectService({
    store,
    samePath: win32.samePath,
    resolvePath: (p) => p,
    isDirectory,
    detect,
    newId: () => `id-${++n}`,
    onChanged,
    logger,
  });
  return { service, store, backend, onChanged, detect, isDirectory, logger };
}

describe('ProjectService.add', () => {
  it('stores the project with its original path casing and detected name', async () => {
    const { service, store, onChanged } = setup();
    const summary = await service.add('C:\\Dev\\Shop');
    expect(summary).toMatchObject({ id: 'id-1', name: 'shop', path: 'C:\\Dev\\Shop', pinned: false });
    expect(store.getProjects()[0]?.path).toBe('C:\\Dev\\Shop');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('falls back to the path when detection finds no name (drive root)', async () => {
    const { service, store, detect } = setup();
    detect.mockImplementationOnce(async (input: DetectInput) => ({ ...fakeDetect(input), name: '' }));
    const summary = await service.add('C:\\');
    expect(summary.name).toBe('C:\\');
    expect(store.getProjects()[0]?.name).toBe('C:\\');
  });

  it('truncates a detected name longer than 100 characters', async () => {
    const { service, store, detect } = setup();
    detect.mockImplementationOnce(async (input: DetectInput) => ({ ...fakeDetect(input), name: 'x'.repeat(150) }));
    await service.add('C:\\Dev\\Long');
    expect(store.getProjects()[0]?.name).toBe('x'.repeat(100));
  });

  it('rejects the same folder with different casing or a trailing separator', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    await expect(service.add('c:\\dev\\shop\\')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'This folder is already added as "shop"',
    });
  });

  it('rejects a folder that does not exist', async () => {
    const { service, isDirectory } = setup();
    isDirectory.mockResolvedValueOnce(false);
    await expect(service.add('C:\\Nope')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

const twoProjects = {
  schemaVersion: 2,
  settings: {},
  projects: [
    { id: 'p1', name: 'Shop', path: 'C:\\Dev\\Shop' },
    { id: 'p2', name: 'Blog', path: 'C:\\Dev\\Blog' },
  ],
};

describe('ProjectService startup', () => {
  it('does not block on detection: init starts it in the background', async () => {
    const { service, detect } = setup(twoProjects);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    detect.mockImplementation(async (input: DetectInput) => {
      await gate;
      return fakeDetect(input);
    });
    const init = service.init();
    let settled = false;
    void init.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(detect).toHaveBeenCalledTimes(2);
    release();
    await init;
  });

  it('list() joins the in-flight detection instead of detecting again', async () => {
    const { service, detect } = setup(twoProjects);
    const init = service.init();
    const listed = await service.list();
    await init;
    expect(listed.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(detect).toHaveBeenCalledTimes(2);
  });

  it('keeps going when one project fails to detect and logs only its id', async () => {
    const { service, detect, logger } = setup(twoProjects);
    detect.mockImplementation(async (input: DetectInput) => {
      if (input.id === 'p1') throw new Error('EACCES C:\\Dev\\Shop secret');
      return fakeDetect(input);
    });
    await service.init();
    expect(service.getDetected('p2').id).toBe('p2');
    expect(logger.entries).toContainEqual({ level: 'warn', message: 'detection failed', fields: { projectId: 'p1' } });
    expect(JSON.stringify(logger.entries)).not.toContain('secret');
  });

  it('refresh runs a fresh detection after an in-flight one', async () => {
    const { service, detect } = setup(twoProjects);
    const init = service.init();
    await service.refresh('p1');
    await init;
    expect(detect.mock.calls.filter(([i]) => i.id === 'p1')).toHaveLength(2);
  });

  it('add rejects, stores nothing and does not notify when detection throws', async () => {
    const { service, store, detect, onChanged } = setup();
    detect.mockRejectedValueOnce(new Error('boom'));
    await expect(service.add('C:\\Dev\\Shop')).rejects.toThrow('boom');
    expect(store.getProjects()).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('ProjectService lookups and edits', () => {
  it('lists projects with detection results', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    const [first] = await service.list();
    expect(first?.detected.workspaces[0]?.id).toBe('id-1::packages/api');
  });

  it('detects stored projects on init and passes the stored name', async () => {
    const { service, detect } = setup({
      schemaVersion: 1,
      settings: {},
      projects: [{ id: 'p1', name: 'My Shop', path: 'C:\\Dev\\Shop' }],
    });
    await service.init();
    expect(detect).toHaveBeenCalledWith({ id: 'p1', path: 'C:\\Dev\\Shop', name: 'My Shop' });
    expect(service.getDetected('p1').name).toBe('My Shop');
  });

  it('finds root and workspace projects by id', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    expect(service.getDetected('id-1').name).toBe('shop');
    expect(service.getDetected('id-1::packages/api').name).toBe('api');
    expect(() => service.getDetected('id-1::nope')).toThrow(NestboxError);
    expect(() => service.getDetected('missing')).toThrow(NestboxError);
  });

  it('renames, keeping the detected name in sync', async () => {
    const { service, store } = setup();
    await service.add('C:\\Dev\\Shop');
    const s = service.rename('id-1', 'Shop Backend');
    expect(s.name).toBe('Shop Backend');
    expect(s.detected.name).toBe('Shop Backend');
    expect(store.getProjects()[0]?.name).toBe('Shop Backend');
  });

  it('pins and unpins', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    expect(service.setPinned('id-1', true).pinned).toBe(true);
    expect(service.setPinned('id-1', false).pinned).toBe(false);
  });

  it('removes a project', async () => {
    const { service, store, onChanged } = setup();
    await service.add('C:\\Dev\\Shop');
    service.remove('id-1');
    expect(store.getProjects()).toEqual([]);
    expect(() => service.getDetected('id-1')).toThrow(NestboxError);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('refuses to rename, pin or remove a workspace package', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    expect(() => service.rename('id-1::packages/api', 'x')).toThrow(/Workspace packages/);
    expect(() => service.remove('id-1::packages/api')).toThrow(/Workspace packages/);
  });

  it('throws NOT_FOUND for unknown ids', async () => {
    const { service } = setup();
    expect(() => service.remove('nope')).toThrow('Project not found');
    expect(() => service.remove('nope')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('refuses to pin a workspace package', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    expect(() => service.setPinned('id-1::packages/api', true)).toThrow(/Workspace packages/);
  });

  it('lets only one of two concurrent adds of the same folder through', async () => {
    const { service, store } = setup();
    const results = await Promise.allSettled([service.add('C:\\Dev\\Shop'), service.add('c:\\dev\\shop\\')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'CONFLICT' });
    expect(store.getProjects()).toHaveLength(1);
  });

  it('ignores a detection that finishes after the project was removed', async () => {
    const { service, detect } = setup();
    await service.add('C:\\Dev\\Shop');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    detect.mockImplementationOnce(async (input: DetectInput) => {
      await gate;
      return fakeDetect(input);
    });
    const pending = service.refresh('id-1');
    service.remove('id-1');
    release();
    await expect(pending).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(() => service.getDetected('id-1')).toThrow(NestboxError);
  });

  it('refresh re-detects the root of a workspace id', async () => {
    const { service, detect } = setup();
    await service.add('C:\\Dev\\Shop');
    detect.mockClear();
    const s = await service.refresh('id-1::packages/api');
    expect(detect).toHaveBeenCalledWith({ id: 'id-1', path: 'C:\\Dev\\Shop', name: 'shop' });
    expect(s.id).toBe('id-1');
  });
});
