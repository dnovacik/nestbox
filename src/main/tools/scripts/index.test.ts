import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { RunGroup } from '@shared/types';
import { createMemoryLogger } from '../../logger';
import { createDarwinAdapter } from '../../platform/darwin';
import { noopRunner } from '../../platform/testing';
import { fakePlatform, flushIo } from '../../processes/fake-child';
import { ProcessManager } from '../../processes/process-manager';
import { createSharedContext } from '../shared-context';
import { createToolHost } from '../tool-host';
import { createScriptsTool, PROCESSES_FACT } from './index';

const ROOT = resolve('/dev/shop');
const API = resolve(ROOT, 'packages/api');

const api = makeDetectedForTest({
  id: 'r1::packages/api',
  rootId: 'r1',
  relPath: 'packages/api',
  name: '@shop/api',
  path: API,
  packageJson: { name: '@shop/api', scripts: { dev: 'nest start --watch' } },
});
const root = makeDetectedForTest({
  id: 'r1',
  rootId: 'r1',
  path: ROOT,
  packageJson: { name: 'shop', scripts: { dev: 'vite', build: 'vite build' } },
  workspaces: [api],
});

function setup() {
  const platform = fakePlatform();
  const processes = new ProcessManager({
    platform,
    ledger: { add: vi.fn(), remove: vi.fn() },
    bufferLines: () => 1_000,
    logger: createMemoryLogger(),
  });
  let groups: RunGroup[] = [];
  const toolSettings = new Map<string, unknown>();
  const shared = createSharedContext();
  const deps = {
    processes,
    runGroups: { get: vi.fn(() => groups), set: vi.fn((_root: string, next: RunGroup[]) => (groups = next)) },
    getDetected: (id: string): DetectedProject => {
      const found = [root, api].find((p) => p.id === id);
      if (!found) throw new NestboxError('NOT_FOUND', 'Project not found');
      return found;
    },
    shared,
    saveFile: vi.fn(async (_name: string): Promise<string | null> => 'C:\\out\\dev.log'),
    writeFile: vi.fn(async (_path: string, _text: string) => {}),
    isFile: vi.fn(async (_path: string) => true),
    emit: vi.fn(),
    logger: createMemoryLogger(),
  };
  const adapter = createDarwinAdapter({ runner: noopRunner, getEditorCommand: () => 'code' });
  const openInEditor = vi.fn(async () => {});
  const host = createToolHost({
    tools: [createScriptsTool(deps)],
    getProject: deps.getDetected,
    shared,
    platform: { ...adapter, openInEditor },
    emit: vi.fn(),
    logger: createMemoryLogger(),
    toolSettings: {
      get: (rootId, toolId) => toolSettings.get(`${rootId}/${toolId}`),
      set: (rootId, toolId, value) => void toolSettings.set(`${rootId}/${toolId}`, value),
    },
  });
  const call = (projectId: string, method: string, input: unknown = {}) => host.invoke('scripts', projectId, method, input);
  return { platform, processes, deps, call, toolSettings, openInEditor, setGroups: (g: RunGroup[]) => (groups = g) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('scripts tool: list and lifecycle', () => {
  it('lists scripts, run groups and packages on a root', async () => {
    const { call, setGroups } = setup();
    setGroups([{ name: 'dev', entries: [{ relPath: '', script: 'dev' }] }]);
    expect(await call('r1', 'list')).toEqual({
      scripts: [
        { name: 'dev', command: 'vite', autoRestart: false },
        { name: 'build', command: 'vite build', autoRestart: false },
      ],
      runGroups: [{ name: 'dev', entries: [{ relPath: '', script: 'dev' }] }],
      packages: [
        { relPath: '', name: 'shop', scripts: ['dev', 'build'] },
        { relPath: 'packages/api', name: '@shop/api', scripts: ['dev'] },
      ],
    });
  });

  it('lists no run groups or packages on a workspace', async () => {
    const { call } = setup();
    expect(await call(api.id, 'list')).toMatchObject({ runGroups: null, packages: null });
  });

  it('starts in the package folder with the package manager', async () => {
    const { call, platform } = setup();
    expect(await call(api.id, 'start', { script: 'dev' })).toMatchObject({ projectId: api.id, script: 'dev', state: 'starting' });
    expect(platform.spawnScript).toHaveBeenCalledWith(expect.objectContaining({ cwd: API, command: 'pnpm', args: ['run', 'dev'] }));
  });

  it('rejects an unknown script without naming it', async () => {
    const { call } = setup();
    await expect(call('r1', 'start', { script: 'secret-name' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Unknown script',
    });
  });

  it('stops and restarts', async () => {
    const { call, platform } = setup();
    await call('r1', 'start', { script: 'dev' });
    expect(await call('r1', 'stop', { script: 'dev' })).toMatchObject({ state: 'stopped' });
    expect(await call('r1', 'restart', { script: 'dev' })).toMatchObject({ state: 'starting' });
    expect(platform.spawnScript).toHaveBeenCalledTimes(2);
  });

  it('stores auto-restart on the root and applies it to a live process', async () => {
    const { call, toolSettings, processes } = setup();
    await call(api.id, 'start', { script: 'dev' });
    expect(await call(api.id, 'setAutoRestart', { script: 'dev', enabled: true })).toEqual({ enabled: true });
    expect(toolSettings.get('r1/scripts')).toEqual({ autoRestart: [{ relPath: 'packages/api', script: 'dev' }] });
    expect(processes.get(api.id, 'dev')?.autoRestart).toBe(true);
    expect(await call(api.id, 'list')).toMatchObject({ scripts: [{ name: 'dev', autoRestart: true }] });
    await call(api.id, 'setAutoRestart', { script: 'dev', enabled: false });
    expect(toolSettings.get('r1/scripts')).toEqual({ autoRestart: [] });
  });

  it('starts with auto-restart from settings', async () => {
    const { call, toolSettings } = setup();
    toolSettings.set('r1/scripts', { autoRestart: [{ relPath: '', script: 'dev' }] });
    expect(await call('r1', 'start', { script: 'dev' })).toMatchObject({ autoRestart: true });
  });
});

describe('scripts tool: logs', () => {
  it('returns logs after a seq', async () => {
    const { call, platform } = setup();
    await call('r1', 'start', { script: 'dev' });
    platform.last().stdout.write('a\nb\n');
    await flushIo();
    expect(await call('r1', 'getLogs', { script: 'dev', afterSeq: 2 })).toMatchObject({
      lines: [{ seq: 3, text: 'b' }],
      lastSeq: 3,
    });
  });

  it('streams batched log events per project and script', async () => {
    const { call, platform, deps } = setup();
    await call(api.id, 'start', { script: 'dev' });
    platform.last().stdout.write('one\ntwo\n');
    await flushIo();
    expect(deps.emit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(deps.emit).toHaveBeenCalledTimes(1);
    expect(deps.emit).toHaveBeenCalledWith(api.id, 'logs', {
      script: 'dev',
      lines: [
        expect.objectContaining({ text: '▸ pnpm run dev' }),
        expect.objectContaining({ text: 'one' }),
        expect.objectContaining({ text: 'two' }),
      ],
    });
  });

  it('publishes process facts to the shared context', async () => {
    const { call, deps } = setup();
    await call('r1', 'start', { script: 'dev' });
    expect(deps.shared.forProject('r1').get(PROCESSES_FACT)).toEqual([{ script: 'dev', pid: 1000, state: 'starting' }]);
  });

  it('empties the published facts of a project whose processes were forgotten', async () => {
    const { call, deps, processes } = setup();
    await call('r1', 'start', { script: 'dev' });
    await processes.stopAll((id) => id === 'r1');
    processes.forget((id) => id === 'r1');
    expect(deps.shared.forProject('r1').get(PROCESSES_FACT)).toEqual([]);
  });

  it('clears logs', async () => {
    const { call } = setup();
    await call('r1', 'start', { script: 'dev' });
    await call('r1', 'clearLogs', { script: 'dev' });
    expect(await call('r1', 'getLogs', { script: 'dev' })).toMatchObject({ lines: [] });
  });

  it('exports selected lines, everything, or nothing when cancelled', async () => {
    const { call, platform, deps } = setup();
    await call('r1', 'start', { script: 'dev' });
    platform.last().stdout.write('a\nb\n');
    await flushIo();
    expect(await call('r1', 'exportLogs', { script: 'dev', seqs: [2, 3] })).toEqual({ saved: true });
    const written = vi.mocked(deps.writeFile).mock.calls[0]?.[1] ?? '';
    expect(written.split('\r\n').filter(Boolean).map((l) => l.slice(25))).toEqual(['a', 'b']);
    await call('r1', 'exportLogs', { script: 'dev', seqs: 'all' });
    expect(vi.mocked(deps.writeFile).mock.calls[1]?.[1].split('\r\n').filter(Boolean)).toHaveLength(3);
    deps.saveFile.mockResolvedValueOnce(null);
    expect(await call('r1', 'exportLogs', { script: 'dev', seqs: 'all' })).toEqual({ saved: false });
    expect(deps.writeFile).toHaveBeenCalledTimes(2);
  });
});

describe('scripts tool: openFileAt', () => {
  it.each([
    ['a relative path', 'src/a.ts', resolve(ROOT, 'src/a.ts')],
    ['a Vite-style rooted path', '/src/App.tsx', resolve(ROOT, 'src/App.tsx')],
    ['an absolute path', resolve('/elsewhere/x.ts'), resolve('/elsewhere/x.ts')],
    ['a file URL', pathToFileURL(resolve('/elsewhere/y.js')).href, resolve('/elsewhere/y.js')],
  ])('opens %s at the line', async (_label, path, expected) => {
    const { call, openInEditor, deps } = setup();
    deps.isFile.mockImplementation(async (p: string) => p === expected);
    await call('r1', 'openFileAt', { path, line: 12 });
    expect(openInEditor).toHaveBeenCalledWith(expected, 12);
  });

  it('falls back to a rooted path as absolute when the project has no such file', async () => {
    const { call, openInEditor, deps } = setup();
    const absolute = resolve('/var/log/app.ts');
    deps.isFile.mockImplementation(async (p: string) => p === absolute);
    await call('r1', 'openFileAt', { path: '/var/log/app.ts', line: 3 });
    expect(openInEditor).toHaveBeenCalledWith(absolute, 3);
  });

  it('refuses a missing file', async () => {
    const { call, openInEditor, deps } = setup();
    deps.isFile.mockResolvedValue(false);
    await expect(call('r1', 'openFileAt', { path: 'nope.ts', line: 1 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'File not found',
    });
    expect(openInEditor).not.toHaveBeenCalled();
  });
});

describe('scripts tool: run groups', () => {
  const group = (name: string, entries: [string, string][]): RunGroup => ({
    name,
    entries: entries.map(([relPath, script]) => ({ relPath, script })),
  });

  it('saves, renames and deletes groups on the root only', async () => {
    const { call } = setup();
    expect(await call('r1', 'saveRunGroup', { group: group('dev', [['', 'dev']]) })).toEqual([group('dev', [['', 'dev']])]);
    await expect(call('r1', 'saveRunGroup', { group: group('dev', [['', 'build']]), previousName: undefined })).resolves.toEqual([
      group('dev', [['', 'build']]),
    ]);
    await call('r1', 'saveRunGroup', { group: group('other', []) });
    await expect(call('r1', 'saveRunGroup', { previousName: 'other', group: group('dev', []) })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await call('r1', 'saveRunGroup', { previousName: 'other', group: group('all', []) })).toEqual([
      group('dev', [['', 'build']]),
      group('all', []),
    ]);
    expect(await call('r1', 'deleteRunGroup', { name: 'dev' })).toEqual([group('all', [])]);
    await expect(call(api.id, 'saveRunGroup', { group: group('x', []) })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(call('r1', 'deleteRunGroup', { name: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('starts what it can and reports missing and running entries', async () => {
    const { call, setGroups, platform } = setup();
    setGroups([
      group('dev', [
        ['', 'dev'],
        ['packages/api', 'dev'],
        ['packages/gone', 'dev'],
        ['', 'nope'],
        ['', 'build'],
      ]),
    ]);
    await call('r1', 'start', { script: 'build' });
    const result = (await call('r1', 'startRunGroup', { name: 'dev' })) as {
      started: { projectId: string }[];
      skipped: unknown[];
    };
    expect(result.started.map((s) => s.projectId).sort()).toEqual(['r1', api.id]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { relPath: 'packages/gone', script: 'dev', reason: 'missing' },
        { relPath: '', script: 'nope', reason: 'missing' },
        { relPath: '', script: 'build', reason: 'running' },
      ]),
    );
    expect(platform.spawnScript).toHaveBeenCalledWith(expect.objectContaining({ cwd: API }));
  });

  it('stopping a group also cancels a member waiting to auto-restart', async () => {
    const { call, setGroups, processes, platform, toolSettings } = setup();
    toolSettings.set('r1/scripts', { autoRestart: [{ relPath: 'packages/api', script: 'dev' }] });
    setGroups([group('dev', [['packages/api', 'dev']])]);
    await call('r1', 'startRunGroup', { name: 'dev' });
    platform.last().exit(1);
    await flushIo();
    expect(processes.get(api.id, 'dev')?.nextRestartAt).not.toBeNull();
    await call('r1', 'stopRunGroup', { name: 'dev' });
    expect(processes.get(api.id, 'dev')).toMatchObject({ state: 'stopped', nextRestartAt: null });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(platform.spawnScript).toHaveBeenCalledTimes(1);
  });

  it('stops only the group\'s live entries', async () => {
    const { call, setGroups, processes } = setup();
    setGroups([group('dev', [['packages/api', 'dev']])]);
    await call('r1', 'start', { script: 'dev' });
    await call('r1', 'startRunGroup', { name: 'dev' });
    await call('r1', 'stopRunGroup', { name: 'dev' });
    expect(processes.get(api.id, 'dev')?.state).toBe('stopped');
    expect(processes.get('r1', 'dev')?.state).toBe('starting');
  });
});
