import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import type { LogSnapshot } from '@shared/processes';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { ClaudeStatus } from '@shared/tools/claude/contract';
import type { RunGroup } from '@shared/types';
import { createMemoryLogger } from '../../logger';
import { fakePlatform, flushIo } from '../../processes/fake-child';
import { createEnvFileAccess } from '../env/env-files';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createClaudeDocs } from './docs';
import { CONTEXT_END, CONTEXT_START } from './context';
import { createClaudeTool } from './index';

let root = '';
let tool: AnyMainTool | null = null;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nestbox-claude-tool-'));
});
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
  await rm(root, { recursive: true, force: true });
});

function setup(project: Partial<DetectedProject> = {}, opts: { groups?: RunGroup[]; ignored?: boolean | null } = {}) {
  const platform = { ...fakePlatform(), openTerminal: vi.fn(async () => undefined) };
  const cli = { status: vi.fn(async () => ({ found: true, version: '2.1.0' })), isIgnored: vi.fn(async () => opts.ignored ?? true) };
  const logger = createMemoryLogger();
  tool = createClaudeTool({ cli, docs: createClaudeDocs(), envFiles: createEnvFileAccess(), runGroups: { get: () => opts.groups ?? [] }, logger });
  const emit = vi.fn();
  const ctx = {
    project: makeDetectedForTest({ path: root, ...project }),
    shared: createSharedContext().forProject('p1'),
    emit,
    platform,
    settings: { get: () => ({}), update: (fn: (s: object) => object) => fn({}) },
  } as unknown as ToolContext;
  const call = <T,>(method: string, input: unknown = {}) => tool?.handlers[method]?.(ctx, input) as Promise<T>;
  return { call, ctx, emit, platform, cli, logger };
}

describe('claude tool', () => {
  it('reports the CLI, files and gitignore state of personal files that exist', async () => {
    await writeFile(join(root, 'CLAUDE.local.md'), '# mine\n');
    const { call, cli } = setup({}, { ignored: false });
    const status = await call<ClaudeStatus>('status');
    expect(status.cli).toEqual({ found: true, version: '2.1.0' });
    expect(status.files.claudeLocalMd).toBe(true);
    expect(status.gitignore).toEqual([{ file: 'CLAUDE.local.md', ignored: false }]);
    expect(cli.isIgnored).toHaveBeenCalledTimes(1);
    expect(status.promptRunning).toBe(false);
  });

  it('reads, creates and saves documents with the version check', async () => {
    const { call } = setup();
    expect(await call('readDoc', { file: 'CLAUDE.md' })).toEqual({ text: '', version: null });
    const { version } = await call<{ version: string }>('writeDoc', { file: 'CLAUDE.md', text: '# A\n', version: null });
    await call('writeDoc', { file: 'CLAUDE.md', text: '# B\n', version });
    await expect(call('writeDoc', { file: 'CLAUDE.md', text: '# C\n', version })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('opens claude and claude --continue in a terminal in the package folder', async () => {
    const { call, platform } = setup();
    await call('open');
    await call('continue');
    expect(platform.openTerminal.mock.calls).toEqual([
      [root, 'claude'],
      [root, 'claude --continue'],
    ]);
  });

  it('runs a prompt through stdin, streams its output and refuses a second run', async () => {
    const { call, platform, emit, logger } = setup();
    const text = 'Explain "this" & that\n100% sure?';
    await call('prompt', { text });
    expect(platform.spawnCommand).toHaveBeenCalledWith(expect.objectContaining({ cwd: root, command: 'claude', args: ['-p'], stdin: text }));
    expect((await call<ClaudeStatus>('status')).promptRunning).toBe(true);
    await expect(call('prompt', { text: 'again' })).rejects.toMatchObject({ code: 'CONFLICT' });

    const child = platform.last();
    child.stdout.write('Hello\nWor');
    child.stdout.write('ld\n');
    child.stderr.write('warn\n');
    child.exit(0);
    await flushIo();
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('logs', expect.anything()));
    const snap = await call<LogSnapshot>('getPromptLogs');
    expect(snap.lines.map((l) => [l.stream, l.text])).toEqual([
      ['system', '▸ claude -p'],
      ['stdout', 'Hello'],
      ['stdout', 'World'],
      ['stderr', 'warn'],
      ['system', '■ done'],
    ]);
    expect((await call<ClaudeStatus>('status')).promptRunning).toBe(false);
    expect(emit).toHaveBeenCalledWith('changed', undefined);
    expect(JSON.stringify(logger.entries)).not.toContain('Explain');
    await call('clearPromptLogs');
    expect((await call<LogSnapshot>('getPromptLogs')).lines).toEqual([]);
  });

  it('stops a prompt by killing its tree', async () => {
    const { call, platform } = setup();
    await call('prompt', { text: 'go' });
    await flushIo();
    const child = platform.last();
    await call('stopPrompt');
    expect(platform.killTree).toHaveBeenCalledWith(child.pid);
    await flushIo();
    expect((await call<LogSnapshot>('getPromptLogs')).lines.at(-1)?.text).toBe('■ stopped');
    expect((await call<ClaudeStatus>('status')).promptRunning).toBe(false);
  });

  it('kills running prompts on dispose and when the project is removed', async () => {
    const { call, platform, emit } = setup({ id: 'p1', rootId: 'p1' });
    await call('prompt', { text: 'go' });
    await flushIo();
    emit.mockClear();
    tool?.forgetProject?.('p1');
    expect(platform.killTree).toHaveBeenCalledWith(platform.last().pid);
    await flushIo();
    await new Promise((r) => setTimeout(r, 60));
    expect(emit).not.toHaveBeenCalled();
  });

  it('previews and applies the context block, keeping hand-written text', async () => {
    await writeFile(join(root, 'CLAUDE.md'), '# Shop\n\nHand-written.\n');
    await writeFile(join(root, '.env'), 'PORT=3001\nSECRET=hunter2\n');
    await writeFile(join(root, '.env.example'), 'DATABASE_URL=postgres://x\n');
    await mkdir(join(root, 'prisma'));
    const { call } = setup(
      {
        packageManager: 'pnpm',
        packageJson: { name: 'shop', scripts: { dev: 'vite' } },
        envFiles: ['.env', '.env.example'],
        prismaSchema: 'prisma/schema.prisma',
      },
      { groups: [{ name: 'all', entries: [{ relPath: '', script: 'dev' }, { relPath: 'packages/api', script: 'start' }] }] },
    );
    const preview = await call<{ before: string; after: string; version: string }>('contextPreview');
    expect(preview.before).toBe('# Shop\n\nHand-written.\n');
    expect(preview.after.startsWith(`# Shop\n\nHand-written.\n\n${CONTEXT_START}\n`)).toBe(true);
    expect(preview.after).toContain('- `dev`: `vite`');
    expect(preview.after).toContain('- all: `dev`, `packages/api:start`');
    expect(preview.after).toContain('(PORT): 3001');
    expect(preview.after).toContain('`DATABASE_URL`');
    expect(preview.after).not.toMatch(/hunter2|postgres/);
    expect(preview.after.trimEnd().endsWith(CONTEXT_END)).toBe(true);

    await call('applyContext', { version: preview.version });
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe(preview.after);
    await expect(call('applyContext', { version: preview.version })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('creates CLAUDE.md when applying the context to a project without one', async () => {
    const { call } = setup();
    const preview = await call<{ version: string | null; after: string }>('contextPreview');
    expect(preview.version).toBeNull();
    await call('applyContext', { version: null });
    expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe(preview.after);
  });
});
