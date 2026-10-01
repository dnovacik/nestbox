import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { defineContract } from '@shared/tool';
import { createMemoryLogger } from '../logger';
import { createDarwinAdapter } from '../platform/darwin';
import { projectInfoTool } from './project-info';
import { createSharedContext } from './shared-context';
import { createToolHost } from './tool-host';
import { defineMainTool } from './types';

const project: DetectedProject = {
  id: 'p1', rootId: 'p1', path: '/p', relPath: '', name: 'shop', missing: false,
  packageJson: { name: 'shop', scripts: {} }, packageManager: 'pnpm', envFiles: [], workspaces: [],
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
    platform: createDarwinAdapter({ runner: { launch: async () => {} }, getEditorCommand: () => 'code' }),
    emit,
    logger: createMemoryLogger(),
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
});
