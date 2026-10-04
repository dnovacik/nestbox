import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { Results } from '@shared/tools/deps/contract';
import { createMemoryLogger } from '../../logger';
import { type FakeChild, fakePlatform } from '../../processes/fake-child';
import { createSharedContext } from '../shared-context';
import type { ToolContext } from '../types';
import { createDepsCache } from './cache';
import { createDepsTool } from './index';

type SpawnArgs = { cwd: string; command: string; args: string[] };
const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

function setup(answers: Record<string, { code: number; stdout: string }> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nestbox-deps-tool-'));
  const api = join(root, 'packages', 'api');
  mkdirSync(api, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'shop', dependencies: { lodash: '4.17.15' } }),
  );
  writeFileSync(
    join(api, 'package.json'),
    JSON.stringify({ name: '@shop/api', devDependencies: { semver: '~6.3.0' } }),
  );

  const all: Record<string, { code: number; stdout: string }> = {
    'npm outdated --json': { code: 1, stdout: fixture('npm-outdated.json') },
    'npm audit --json': { code: 1, stdout: fixture('npm-audit.json') },
    ...answers,
  };
  const base = fakePlatform();
  const spawnCommand = vi.fn((o: SpawnArgs) => {
    const child = fakePlatform().spawnCommand() as unknown as FakeChild;
    base.children.push(child);
    const answer = all[`${o.command} ${o.args.join(' ')}`];
    queueMicrotask(() => {
      if (answer) child.stdout.write(answer.stdout);
      child.exit(answer?.code ?? 1);
    });
    return child;
  });
  const platform = { ...base, spawnCommand };
  const workspace = makeDetectedForTest({
    id: 'r1::packages/api',
    rootId: 'r1',
    relPath: 'packages/api',
    name: '@shop/api',
    path: api,
    packageManager: 'npm',
  });
  const rootProject = makeDetectedForTest({
    id: 'r1',
    rootId: 'r1',
    path: root,
    name: 'shop',
    packageManager: 'npm',
    workspaces: [workspace],
  });
  const logger = createMemoryLogger();
  const cache = createDepsCache(join(root, 'deps-cache.json'), logger);
  const running = new Set<string>();
  const clipboard = { writeText: vi.fn() };
  const tool = createDepsTool({ logger, cache, running, clipboard, now: () => 1_000 });
  const ctxFor = (project: DetectedProject) =>
    ({
      project,
      shared: createSharedContext().forProject(project.id),
      emit: vi.fn(),
      platform,
      settings: { get: () => ({}), update: () => ({}) },
    }) as unknown as ToolContext;
  const rootCtx = ctxFor(rootProject);
  const call = <T>(method: string, input: unknown = {}, ctx = rootCtx) =>
    tool.handlers[method]?.(ctx, input) as Promise<T>;
  return {
    call,
    tool,
    cache,
    running,
    clipboard,
    logger,
    spawnCommand,
    rootCtx,
    apiCtx: ctxFor(workspace),
    root,
  };
}

describe('deps tool', () => {
  it('has no results before a check and never checks on its own', async () => {
    const { call, spawnCommand } = setup();
    expect(await call<Results>('results')).toEqual({ packages: [], checking: false });
    expect(spawnCommand).not.toHaveBeenCalled();
  });

  it('checks the root and each workspace package, one at a time, and keeps the results', async () => {
    const { call, cache, spawnCommand, rootCtx, root } = setup();
    const results = await call<Results>('check');
    expect(results.checking).toBe(false);
    expect(results.packages.map((p) => [p.projectId, p.manager, p.checkedAt])).toEqual([
      ['r1', 'npm', 1_000],
      ['r1::packages/api', 'npm', 1_000],
    ]);
    expect(results.packages[0]?.rows.find((r) => r.name === 'lodash')).toMatchObject({
      outdated: true,
      advisories: [expect.anything(), expect.anything()],
    });
    expect(
      spawnCommand.mock.calls.map(([o]) => [o.cwd === root ? 'root' : 'api', o.args[0]]),
    ).toEqual([
      ['root', 'outdated'],
      ['root', 'audit'],
      ['api', 'outdated'],
      ['api', 'audit'],
    ]);
    expect(cache.get('r1::packages/api')?.relPath).toBe('packages/api');
    expect(rootCtx.emit).toHaveBeenCalledTimes(2);
  });

  it('checks only the package itself from a workspace package', async () => {
    const { call, apiCtx } = setup();
    expect((await call<Results>('check', {}, apiCtx)).packages.map((p) => p.projectId)).toEqual([
      'r1::packages/api',
    ]);
  });

  it('refuses a second check of the same project while one runs', async () => {
    const { call, running } = setup();
    running.add('r1');
    await expect(call('check')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await call<Results>('results')).checking).toBe(true);
  });

  it('logs counts and codes, never package names or output', async () => {
    const { call, logger } = setup();
    await call('check');
    const text = JSON.stringify(logger.entries);
    expect(text).toContain('deps check');
    expect(text).not.toMatch(/lodash|GHSA|github\.com/);
  });

  it('copies the update command for a direct dependency from the clipboard in main', async () => {
    const { call, clipboard } = setup();
    await call('check');
    expect(await call('copyUpdateCommand', { relPath: 'packages/api', name: 'semver' })).toEqual({
      command: 'npm install -D semver@latest',
    });
    expect(clipboard.writeText).toHaveBeenCalledWith('npm install -D semver@latest');
    await expect(call('copyUpdateCommand', { relPath: '', name: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      call('copyUpdateCommand', { relPath: '../other', name: 'semver' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('forgets a removed project', async () => {
    const { call, tool, cache } = setup();
    await call('check');
    tool.forgetProject?.('r1');
    expect(cache.all()).toEqual([]);
  });
});
