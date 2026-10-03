import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { TodoScan } from '@shared/tools/todos/contract';
import { createMemoryLogger } from '../../logger';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createTodosTool } from './index';

let root = '';
let tool: AnyMainTool | null = null;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nestbox-todos-tool-'));
  await writeFile(join(root, 'a.ts'), '// TODO: secret plan\n// NOTE: later\n');
});
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
  await rm(root, { recursive: true, force: true });
});

function setup(opts: { git?: { code: number; stdout: string } | Error } = {}) {
  let settings: { tags: string[] } = { tags: ['TODO', 'FIXME'] };
  const execCommand = vi.fn(async () => {
    const r = opts.git ?? { code: 128, stdout: '' };
    if (r instanceof Error) throw r;
    return r;
  });
  const platform = { execCommand, openInEditor: vi.fn(async () => undefined) };
  const logger = createMemoryLogger();
  tool = createTodosTool({ logger, now: () => 1_000 });
  const ctx = {
    project: makeDetectedForTest({ path: root }),
    shared: createSharedContext().forProject('p1'),
    emit: vi.fn(),
    platform,
    settings: {
      get: () => settings,
      update: (fn: (s: typeof settings) => typeof settings) => (settings = fn(settings)),
    },
  } as unknown as ToolContext;
  const call = <T,>(method: string, input: unknown = {}) => tool?.handlers[method]?.(ctx, input) as Promise<T>;
  return { call, platform, logger, execCommand };
}

describe('todos tool', () => {
  it('has no result until the first scan, then keeps it', async () => {
    const { call } = setup();
    expect(await call('results')).toBeNull();
    const scan = await call<TodoScan>('scan');
    expect(scan).toMatchObject({ source: 'walk', files: 1, truncated: null, scannedAt: 1_000 });
    expect(scan.todos).toEqual([{ path: 'a.ts', line: 1, tag: 'TODO', text: 'secret plan', owner: null }]);
    expect(await call('results')).toEqual(scan);
  });

  it('lists files with git when it can', async () => {
    const { call, execCommand } = setup({ git: { code: 0, stdout: 'a.ts\0' } });
    expect(await call<TodoScan>('scan')).toMatchObject({ source: 'git', files: 1 });
    expect(execCommand).toHaveBeenCalledWith('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], expect.objectContaining({ cwd: root }));
  });

  it('shares one running scan between callers', async () => {
    const { call, execCommand } = setup();
    const [a, b] = await Promise.all([call('scan'), call('scan')]);
    expect(a).toBe(b);
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it('changes the tags, which clears the result', async () => {
    const { call } = setup();
    await call('scan');
    expect(await call('setTags', { tags: ['NOTE'] })).toEqual(['NOTE']);
    expect(await call('getTags')).toEqual(['NOTE']);
    expect(await call('results')).toBeNull();
    expect((await call<TodoScan>('scan')).todos.map((t) => t.tag)).toEqual(['NOTE']);
  });

  it('opens a file at a line, inside the package only', async () => {
    const { call, platform } = setup();
    await call('openFile', { path: 'a.ts', line: 2 });
    expect(platform.openInEditor).toHaveBeenCalledWith(join(root, 'a.ts'), 2);
    await expect(call('openFile', { path: '../x.ts', line: 1 })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(call('openFile', { path: 'gone.ts', line: 1 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('logs counts, never the text or paths', async () => {
    const { call, logger } = setup();
    await call('scan');
    const logged = JSON.stringify(logger.entries);
    expect(logged).toContain('todos scan');
    expect(logged).not.toMatch(/secret plan|a\.ts/);
  });

  it('drops the result of a removed project', async () => {
    const { call } = setup();
    await call('scan');
    tool?.forgetProject?.('p1');
    expect(await call('results')).toBeNull();
  });
});
