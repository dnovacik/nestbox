// The TODO scan against a real repository and the real git, through the platform adapter of this OS.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { TodoScan } from '@shared/tools/todos/contract';
import { createMemoryLogger } from '../../logger';
import { spawnRunner } from '../../platform/command-runner';
import { createPlatformAdapter } from '../../platform';
import { createSharedContext } from '../shared-context';
import type { ToolContext } from '../types';
import { createTodosTool } from './index';

const hasGit = spawnSync('git', ['--version']).status === 0;

describe.runIf(hasGit)('TODO scan on a real repository (integration)', () => {
  let repo = '';
  const tool = createTodosTool({ logger: createMemoryLogger() });

  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'nestbox-todos-int-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    await mkdir(join(repo, 'src'));
    await mkdir(join(repo, 'dist'));
    await writeFile(join(repo, '.gitignore'), 'dist/\n*.log\n');
    await writeFile(join(repo, 'src', 'tracked.ts'), '// TODO: tracked\n');
    await writeFile(join(repo, 'src', 'new file.py'), '# FIXME: untracked but not ignored\n');
    await writeFile(join(repo, 'dist', 'bundle.js'), '// TODO: ignored build output\n');
    await writeFile(join(repo, 'debug.log'), '// TODO: ignored log\n');
    execFileSync('git', ['add', 'src/tracked.ts', '.gitignore'], { cwd: repo });
  });
  afterAll(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("reports tracked and untracked files' TODOs, never ignored ones", async () => {
    const ctx = {
      project: makeDetectedForTest({ path: repo }),
      shared: createSharedContext().forProject('p1'),
      emit: vi.fn(),
      platform: createPlatformAdapter({ runner: spawnRunner, getEditorCommand: () => 'code' }),
      settings: { get: () => ({ tags: ['TODO', 'FIXME'] }), update: (fn: (s: object) => object) => fn({}) },
    } as unknown as ToolContext;
    const scan = (await tool.handlers.scan?.(ctx, {})) as TodoScan;
    expect(scan.source).toBe('git');
    expect(scan.todos.map((t) => `${t.path}:${t.line}:${t.tag}`)).toEqual(['src/new file.py:1:FIXME', 'src/tracked.ts:1:TODO']);
  }, 30_000);
});
