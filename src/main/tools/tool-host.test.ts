import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { defineContract } from '@shared/tool';
import { createRouter, type CoreHandlers } from '../ipc/router';
import { createMemoryLogger } from '../logger';
import { createDarwinAdapter } from '../platform/darwin';
import { projectInfoTool } from './project-info';
import { createSharedContext } from './shared-context';
import { createToolHost } from './tool-host';
import { defineMainTool } from './types';
import { noopRunner } from '../platform/testing';

const project: DetectedProject = {
  id: 'p1', rootId: 'p1', path: '/p', relPath: '', name: 'shop', missing: false,
  packageJson: { name: 'shop', scripts: {} }, packageManager: 'pnpm', envFiles: [], envSymlinks: [], workspaces: [],
  prismaSchema: null, dockerCompose: null, git: null, buildOutput: null,
  claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
};

const echoContract = defineContract({
  echo: { input: z.strictObject({ text: z.string() }), output: z.object({ text: z.string() }) },
  broken: { input: z.strictObject({}), output: z.object({ n: z.number() }) },
});
const echoTool = defineMainTool({
  id: 'echo', name: 'Echo', icon: 'repeat', settingsSchema: z.object({}),
  appliesTo: (p) => p.packageManager === 'pnpm',
  contract: echoContract,
  handlers: {
    echo: async (ctx, input) => {
      ctx.shared.publish('last', input.text);
      ctx.emit('echoed', { text: input.text });
      return { text: input.text, extra: 'stripped' } as { text: string };
    },
    broken: async () => ({ n: 'not a number' }) as unknown as { n: number },
  },
});

function memoryToolSettings(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    get: vi.fn((rootId: string, toolId: string) => store.get(`${rootId}/${toolId}`)),
    set: vi.fn((rootId: string, toolId: string, value: unknown) => void store.set(`${rootId}/${toolId}`, value)),
  };
}

function host(getProject = (id: string) => {
  if (id !== 'p1') throw new NestboxError('NOT_FOUND', 'Project not found');
  return project;
}) {
  const emit = vi.fn();
  const shared = createSharedContext();
  const h = createToolHost({
    tools: [projectInfoTool, echoTool],
    getProject,
    shared,
    platform: createDarwinAdapter({ runner: noopRunner, getEditorCommand: () => 'code' }),
    emit,
    logger: createMemoryLogger(),
    toolSettings: memoryToolSettings(),
  });
  return { h, emit, shared };
}

describe('tool host', () => {
  it('lists tools that apply to the project', () => {
    expect(host().h.list('p1')).toEqual([
      { id: 'project-info', name: 'Project info', icon: 'info' },
      { id: 'echo', name: 'Echo', icon: 'repeat' },
    ]);
  });

  it('invokes the Project info tool and returns the detected project', async () => {
    expect(await host().h.invoke('project-info', 'p1', 'getFacts', {})).toEqual(project);
  });

  it('validates input, gives handlers a context and strips output', async () => {
    const { h, emit, shared } = host();
    expect(await h.invoke('echo', 'p1', 'echo', { text: 'hi' })).toEqual({ text: 'hi' });
    expect(shared.forProject('p1').get('last')).toBe('hi');
    expect(emit).toHaveBeenCalledWith({ toolId: 'echo', projectId: 'p1', event: 'echoed', payload: { text: 'hi' } });
  });

  it.each([
    ['unknown tool', 'nope', 'p1', 'echo', {}, 'NOT_FOUND'],
    ['unknown project', 'echo', 'p2', 'echo', {}, 'NOT_FOUND'],
    ['unknown method', 'echo', 'p1', 'nope', {}, 'NOT_FOUND'],
    ['prototype method name', 'echo', 'p1', 'toString', {}, 'NOT_FOUND'],
    ['invalid input', 'echo', 'p1', 'echo', { text: 1 }, 'VALIDATION'],
    ['invalid output', 'echo', 'p1', 'broken', {}, 'INTERNAL'],
  ])('rejects %s', async (_l, toolId, projectId, method, input, code) => {
    await expect(host().h.invoke(toolId, projectId, method, input)).rejects.toMatchObject({ code });
  });

  it('refuses tools that do not apply to the project', async () => {
    const { h } = host(() => ({ ...project, packageManager: null }));
    expect(h.list('p1').map((t) => t.id)).toEqual(['project-info']);
    await expect(h.invoke('echo', 'p1', 'echo', { text: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('never puts input values in errors or logs when a handler throws', async () => {
    const secret = 'postgres://user:hunter2@db/prod';
    const leaky = defineMainTool({
      id: 'leaky', name: 'Leaky', icon: 'x', settingsSchema: z.object({}), appliesTo: () => true,
      contract: defineContract({ run: { input: z.strictObject({ value: z.string() }), output: z.void() } }),
      handlers: {
        run: async (_ctx, input) => {
          throw new Error(`boom ${input.value}`);
        },
      },
    });
    const logger = createMemoryLogger();
    const h = createToolHost({
      tools: [leaky],
      getProject: () => project,
      shared: createSharedContext(),
      platform: createDarwinAdapter({ runner: noopRunner, getEditorCommand: () => 'code' }),
      emit: vi.fn(),
      logger,
      toolSettings: memoryToolSettings(),
    });
    const handlers = { 'tools:invoke': ({ toolId, projectId, method, input }) => h.invoke(toolId, projectId, method, input) } as Partial<CoreHandlers> as CoreHandlers;
    const dispatch = createRouter({ handlers, isTrustedSender: () => true, logger });
    const env = await dispatch('tools:invoke', 'file:///x', { toolId: 'leaky', projectId: 'p1', method: 'run', input: { value: secret } });
    expect(env).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(env)).not.toContain('hunter2');
    expect(JSON.stringify(logger.entries)).not.toContain('hunter2');
  });

  describe('tool settings', () => {
    const settingsSchema = z.object({ level: z.number().int().default(1) });
    const settingsTool = defineMainTool({
      id: 'cfg', name: 'Cfg', icon: 'x', settingsSchema, appliesTo: () => true,
      contract: defineContract({
        read: { input: z.strictObject({}), output: z.object({ level: z.number() }) },
        write: { input: z.strictObject({ level: z.unknown() }), output: z.object({ level: z.number() }) },
      }),
      handlers: {
        read: async (ctx) => ctx.settings.get(),
        write: async (ctx, input) => ctx.settings.update((s) => ({ ...s, level: input.level as number })),
      },
    });
    const ws: DetectedProject = { ...project, id: 'p1::packages/api', relPath: 'packages/api' };

    function settingsHost(initial: Record<string, unknown> = {}) {
      const toolSettings = memoryToolSettings(initial);
      const logger = createMemoryLogger();
      const h = createToolHost({
        tools: [settingsTool],
        getProject: (id) => (id === ws.id ? ws : project),
        shared: createSharedContext(),
        platform: createDarwinAdapter({ runner: noopRunner, getEditorCommand: () => 'code' }),
        emit: vi.fn(),
        logger,
        toolSettings,
      });
      return { h, toolSettings, logger };
    }

    it('returns schema defaults when nothing is stored', async () => {
      expect(await settingsHost().h.invoke('cfg', 'p1', 'read', {})).toEqual({ level: 1 });
    });

    it('returns stored values, and defaults with one warning when they are invalid', async () => {
      expect(await settingsHost({ 'p1/cfg': { level: 4 } }).h.invoke('cfg', 'p1', 'read', {})).toEqual({ level: 4 });
      const { h, logger } = settingsHost({ 'p1/cfg': { level: 'x' } });
      expect(await h.invoke('cfg', 'p1', 'read', {})).toEqual({ level: 1 });
      expect(logger.entries).toEqual([
        { level: 'warn', message: 'tool settings invalid, using defaults', fields: { toolId: 'cfg' } },
      ]);
    });

    it('validates updates and stores them on the root project, also from a workspace', async () => {
      const { h, toolSettings } = settingsHost();
      expect(await h.invoke('cfg', ws.id, 'write', { level: 7 })).toEqual({ level: 7 });
      expect(toolSettings.set).toHaveBeenCalledWith('p1', 'cfg', { level: 7 });
      await expect(h.invoke('cfg', 'p1', 'write', { level: 1.5 })).rejects.toBeDefined();
      expect(toolSettings.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('disposeAll', () => {
    it('reports tools that fail or outlast the timeout, by id', async () => {
      const make = (id: string, dispose: () => Promise<void>) =>
        defineMainTool({
          id, name: id, icon: 'x', settingsSchema: z.object({}), appliesTo: () => true,
          contract: defineContract({}), handlers: {}, dispose,
        });
      const logger = createMemoryLogger();
      const h = createToolHost({
        tools: [
          make('a', async () => {
            throw new Error('boom');
          }),
          make('b', () => new Promise(() => {})),
          make('c', async () => {}),
        ],
        getProject: () => project,
        shared: createSharedContext(),
        platform: createDarwinAdapter({ runner: noopRunner, getEditorCommand: () => 'code' }),
        emit: vi.fn(),
        logger,
        toolSettings: memoryToolSettings(),
      });
      const started = Date.now();
      expect(await h.disposeAll(50)).toEqual({ failed: ['a'], timedOut: ['b'] });
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(logger.entries).toEqual(
        expect.arrayContaining([
          { level: 'warn', message: 'tool dispose failed', fields: { toolId: 'a' } },
          { level: 'warn', message: 'tool dispose timed out', fields: { toolId: 'b' } },
        ]),
      );
    });
  });
});
