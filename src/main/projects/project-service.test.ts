import { describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import type { DetectInput } from '../detection/detect-project';
import { createMemoryLogger } from '../logger';
import { createWin32Adapter } from '../platform/win32';
import { createMemoryBackend } from '../store/backend';
import { StoreService } from '../store/store-service';
import { DETECTION_WAIT_MS, ProjectService } from './project-service';
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
    envFiles: [], envSymlinks: [],
    workspaces: [
      { ...emptyDetected(), id: `${input.id}::packages/api`, rootId: input.id, relPath: 'packages/api', name: 'api', path: `${input.path}\\packages\\api` },
    ],
    prismaSchema: null,
    dockerCompose: null, deploy: [],
    git: null,
    buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
  };
}

function emptyDetected(): DetectedProject {
  return {
    id: 'x', rootId: 'x', path: 'x', relPath: '', name: 'x', missing: false, packageJson: null,
    packageManager: null, envFiles: [], envSymlinks: [], workspaces: [], prismaSchema: null, dockerCompose: null, deploy: [],
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

  it('getDetectedAsync waits for a detection still in flight', async () => {
    const { service, detect } = setup({
      schemaVersion: 1,
      settings: {},
      projects: [{ id: 'p1', name: 'Shop', path: 'C:\\Dev\\Shop' }],
    });
    let finish = (): void => {};
    detect.mockImplementationOnce(
      (input: DetectInput) => new Promise<DetectedProject>((resolve) => (finish = () => resolve(fakeDetect(input)))),
    );
    const init = service.init();
    expect(() => service.getDetected('p1')).toThrow(NestboxError);
    const pending = service.getDetectedAsync('p1::packages/api');
    finish();
    expect((await pending).name).toBe('api');
    await init;
  });

  it('getDetectedAsync throws NOT_FOUND for unknown ids without waiting', async () => {
    const { service } = setup();
    await expect(service.getDetectedAsync('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getDetectedAsync gives up after the wait limit', async () => {
    vi.useFakeTimers();
    try {
      const { service, detect } = setup({
        schemaVersion: 1,
        settings: {},
        projects: [{ id: 'p1', name: 'Shop', path: 'C:\\Dev\\Shop' }],
      });
      detect.mockImplementationOnce(() => new Promise<DetectedProject>(() => {}));
      void service.init();
      const pending = expect(service.getDetectedAsync('p1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await vi.advanceTimersByTimeAsync(DETECTION_WAIT_MS);
      await pending;
    } finally {
      vi.useRealTimers();
    }
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

  it('refuses to pin or remove a workspace package (renaming one gives it an alias)', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    expect(() => service.setPinned('id-1::packages/api', true)).toThrow(/Workspace packages/);
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

describe('ProjectService run groups and tool settings', () => {
  const group = { name: 'dev', entries: [{ relPath: '', script: 'api' }, { relPath: 'packages/api', script: 'dev' }], compose: [] };

  it('stores run groups on a root project and notifies', async () => {
    const { service, onChanged, store } = setup();
    await service.add('C:\\Dev\\Shop');
    onChanged.mockClear();
    expect(service.setRunGroups('id-1', [group])).toEqual([group]);
    expect(service.getRunGroups('id-1')).toEqual([group]);
    expect(store.getProjects()[0]?.runGroups).toEqual([group]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('refuses run groups on a workspace and invalid groups', async () => {
    const { service, store } = setup();
    await service.add('C:\\Dev\\Shop');
    expect(() => service.setRunGroups('id-1::packages/api', [group])).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => service.setRunGroups('id-1', [{ name: '', entries: [], compose: [] }])).toThrow();
    expect(store.getProjects()[0]?.runGroups).toEqual([]);
  });

  it('round-trips tool settings per tool id', async () => {
    const { service, store } = setup();
    await service.add('C:\\Dev\\Shop');
    expect(service.getToolSettings('id-1', 'scripts')).toBeUndefined();
    service.setToolSettings('id-1', 'scripts', { autoRestart: [] });
    expect(service.getToolSettings('id-1', 'scripts')).toEqual({ autoRestart: [] });
    expect(service.getToolSettings('id-1', 'toString')).toBeUndefined();
    expect(store.getProjects()[0]?.toolSettings).toEqual({ scripts: { autoRestart: [] } });
  });
});

describe('ProjectService: groups and order', () => {
  async function three() {
    const ctx = setup();
    await ctx.service.add('C:\\Dev\\Shop');
    await ctx.service.add('C:\\Dev\\Blog');
    await ctx.service.add('C:\\Dev\\Api');
    return ctx;
  }
  const order = (store: StoreService) => store.getProjects().map((p) => `${p.name}:${p.groupId ?? '-'}`);

  it('creates, renames, collapses and deletes groups; deleting ungroups its projects', async () => {
    const { service, store, onChanged } = await three();
    const work = service.createGroup('Work');
    expect(service.listGroups()).toEqual([{ id: 'id-4', name: 'Work', collapsed: false }]);
    service.moveProject('id-1', work.id, null);
    service.renameGroup(work.id, 'Client work');
    service.setGroupCollapsed(work.id, true);
    expect(service.listGroups()).toEqual([{ id: 'id-4', name: 'Client work', collapsed: true }]);
    expect((await service.list()).find((p) => p.id === 'id-1')?.groupId).toBe('id-4');
    service.deleteGroup(work.id);
    expect(service.listGroups()).toEqual([]);
    expect(order(store)).toEqual(['blog:-', 'api:-', 'shop:-']);
    expect(onChanged).toHaveBeenCalled();
  });

  it('moves a project into a group before another one, or to the end', async () => {
    const { service, store } = await three();
    const g = service.createGroup('Work');
    service.moveProject('id-3', g.id, null);
    service.moveProject('id-1', g.id, 'id-3');
    expect(order(store)).toEqual(['blog:-', 'shop:id-4', 'api:id-4']);
    service.moveProject('id-3', null, 'id-2');
    expect(order(store)).toEqual(['api:-', 'blog:-', 'shop:id-4']);
  });

  it('reorders groups', async () => {
    const { service } = await three();
    const a = service.createGroup('A');
    const b = service.createGroup('B');
    service.moveGroup(b.id, a.id);
    expect(service.listGroups().map((g) => g.name)).toEqual(['B', 'A']);
    service.moveGroup(b.id, null);
    expect(service.listGroups().map((g) => g.name)).toEqual(['A', 'B']);
  });

  it('refuses unknown groups, packages and a move before a project in another group', async () => {
    const { service } = await three();
    const g = service.createGroup('Work');
    expect(() => service.moveProject('id-1', 'nope', null)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(() => service.moveProject('id-1::packages/api', null, null)).toThrow(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => service.moveProject('id-1', g.id, 'id-2')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => service.renameGroup('nope', 'x')).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('gives a workspace package an alias, shown in the summary', async () => {
    const { service, store } = await three();
    service.rename('id-1::packages/api', 'Backend');
    expect(store.getProjects()[0]?.aliases).toEqual({ 'packages/api': 'Backend' });
    expect((await service.list())[0]?.detected.workspaces[0]?.name).toBe('Backend');
  });
});

describe('ProjectService.scan and addFolders', () => {
  /** A folder without its own package.json holding app/ and api/. */
  function withFolders(detect: ReturnType<typeof setup>['detect']) {
    detect.mockImplementation(async (input: DetectInput) => {
      const base = fakeDetect(input);
      if (input.path !== 'C:\\Dev\\Shop') return { ...base, workspaces: [] };
      return {
        ...base,
        name: 'Shop',
        workspaces: ['app', 'api'].map((rel) => ({
          ...emptyDetected(),
          id: `${input.id}::${rel}`,
          rootId: input.id,
          relPath: rel,
          name: `shop-${rel}`,
          path: `${input.path}\\${rel}`,
        })),
      };
    });
  }

  it('offers the sub-folders of a folder without its own package.json', async () => {
    const { service, detect, store } = setup();
    withFolders(detect);
    expect(await service.scan('C:\\Dev\\Shop')).toEqual({
      name: 'Shop',
      folders: [
        { relPath: 'app', name: 'shop-app' },
        { relPath: 'api', name: 'shop-api' },
      ],
    });
    expect(store.getProjects()).toEqual([]);
  });

  it('offers nothing for a package or a workspace root (they stay one project)', async () => {
    const { service, detect } = setup();
    detect.mockImplementation(async (input: DetectInput) => ({
      ...fakeDetect(input),
      packageJson: { name: 'mono', scripts: {} },
    }));
    expect(await service.scan('C:\\Dev\\Mono')).toEqual({ name: 'mono', folders: [] });
  });

  it('adds each sub-folder as its own project inside a new group', async () => {
    const { service, detect, store, onChanged } = setup();
    withFolders(detect);
    const added = await service.addFolders('C:\\Dev\\Shop', 'Shop');
    expect(added.map((p) => [p.name, p.path])).toEqual([
      ['app', 'C:\\Dev\\Shop\\app'],
      ['api', 'C:\\Dev\\Shop\\api'],
    ]);
    const [group] = store.getGroups();
    expect(group?.name).toBe('Shop');
    expect(store.getProjects().map((p) => p.groupId)).toEqual([group?.id, group?.id]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('adds them to the root without a group, skipping folders already added', async () => {
    const { service, detect, store } = setup();
    withFolders(detect);
    await service.add('C:\\Dev\\Shop\\app');
    const added = await service.addFolders('C:\\Dev\\Shop', null);
    expect(added.map((p) => p.path)).toEqual(['C:\\Dev\\Shop\\api']);
    expect(store.getGroups()).toEqual([]);
    expect(store.getProjects().map((p) => p.path)).toEqual([
      'C:\\Dev\\Shop\\app',
      'C:\\Dev\\Shop\\api',
    ]);
  });

  it('refuses a folder with nothing to split', async () => {
    const { service, detect } = setup();
    detect.mockImplementation(async (input: DetectInput) => ({
      ...fakeDetect(input),
      workspaces: [],
    }));
    await expect(service.addFolders('C:\\Dev\\Empty', null)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
