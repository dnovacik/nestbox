import type { ChildProcess } from 'node:child_process';
import { NestboxError } from '@shared/errors';
import { belongsTo, type LogLine } from '@shared/processes';
import { claudeContract, claudeDefinition, type ClaudeStatus } from '@shared/tools/claude/contract';
import type { RunGroup } from '@shared/types';
import type { Logger } from '../../logger';
import { LineSplitter } from '../../processes/line-splitter';
import { BatchedLog } from '../batched-log';
import type { EnvFileAccess } from '../env/env-files';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { readClaudeFiles } from './claude-files';
import type { ClaudeCli } from './cli';
import { applyBlock, buildBlock, type ContextFacts } from './context';
import type { ClaudeDocs } from './docs';
import { readEnvFacts } from './env-facts';

export interface ClaudeToolDeps {
  cli: ClaudeCli;
  docs: ClaudeDocs;
  envFiles: Pick<EnvFileAccess, 'read'>;
  runGroups: { get(rootId: string): RunGroup[] };
  logger: Logger;
}

const LOG_LINES = 2_000;
/** Personal files that belong in .gitignore. */
const PERSONAL_FILES = ['CLAUDE.local.md', '.claude/settings.local.json'] as const;

type Ctx = ToolContext<Record<string, never>>;

interface PromptRun {
  child: ChildProcess;
  stopping: boolean;
  /** Kills the run's process tree through the platform it was started with. */
  killTree(pid: number): Promise<void>;
}

interface ProjectState {
  run: PromptRun | null;
  logs: BatchedLog;
}

export function createClaudeTool(deps: ClaudeToolDeps): AnyMainTool {
  /** By project id (root or workspace package). */
  const states = new Map<string, ProjectState>();

  function stateOf(ctx: Ctx): ProjectState {
    const emit = (lines: LogLine[]) => ctx.emit('logs', { lines });
    const existing = states.get(ctx.project.id);
    if (existing) {
      existing.logs.emit = emit;
      return existing;
    }
    const created: ProjectState = { run: null, logs: new BatchedLog(LOG_LINES, emit) };
    states.set(ctx.project.id, created);
    return created;
  }

  async function stopRun(state: ProjectState): Promise<void> {
    const run = state.run;
    if (!run || run.stopping) return;
    run.stopping = true;
    if (run.child.pid !== undefined) await run.killTree(run.child.pid);
  }

  async function startPrompt(ctx: Ctx, text: string): Promise<void> {
    const state = stateOf(ctx);
    if (state.run) throw new NestboxError('CONFLICT', 'A prompt is already running for this package');
    const env = await ctx.platform.resolveShellEnv();
    // The prompt travels only through stdin: it can hold quotes and newlines cmd.exe can't take safely.
    const child = ctx.platform.spawnCommand({ cwd: ctx.project.path, command: 'claude', args: ['-p'], env, stdin: text });
    const run: PromptRun = { child, stopping: false, killTree: (pid) => ctx.platform.killTree(pid) };
    state.run = run;
    state.logs.push('system', '▸ claude -p');
    const splitters = { stdout: new LineSplitter(), stderr: new LineSplitter() };
    for (const stream of ['stdout', 'stderr'] as const) {
      child[stream]?.on('data', (chunk: Buffer) => {
        for (const line of splitters[stream].push(chunk)) state.logs.push(stream, line);
      });
    }
    let ended = false;
    const end = (message: string) => {
      if (ended) return;
      ended = true;
      for (const stream of ['stdout', 'stderr'] as const) for (const line of splitters[stream].flush(true)) state.logs.push(stream, line);
      state.logs.push('system', message);
      if (state.run === run) state.run = null;
      // Nothing to tell about a project that was removed meanwhile.
      if (states.get(ctx.project.id) === state) ctx.emit('changed', undefined);
    };
    child.once('error', () => end('■ claude could not be started'));
    child.once('close', (code: number | null) => {
      if (run.stopping) end('■ stopped');
      else end(code === 0 ? '■ done' : `■ exited with code ${code ?? 'unknown'}`);
    });
    deps.logger.info('claude prompt started', { projectId: ctx.project.id });
    ctx.emit('changed', undefined);
  }

  async function contextFacts(ctx: Ctx): Promise<ContextFacts> {
    const p = ctx.project;
    const env = await readEnvFacts(deps.envFiles, p.path, p.envFiles);
    return {
      packageManager: p.packageManager,
      scripts: Object.entries(p.packageJson?.scripts ?? {}).map(([name, command]) => ({ name, command })),
      // Run groups belong to the root project; their entries name packages by relPath.
      runGroups:
        p.relPath === ''
          ? deps.runGroups.get(p.rootId).map((g) => ({
              name: g.name,
              scripts: g.entries.map((e) => (e.relPath === '' ? e.script : `${e.relPath}:${e.script}`)),
            }))
          : [],
      workspaces: p.workspaces.map((w) => ({ name: w.name, relPath: w.relPath })),
      prismaSchema: p.prismaSchema,
      dockerCompose: p.dockerCompose,
      port: env.port,
      envKeys: env.envKeys,
    };
  }

  return defineMainTool({
    ...claudeDefinition,
    contract: claudeContract,
    handlers: {
      status: async (ctx: Ctx): Promise<ClaudeStatus> => {
        const dir = ctx.project.path;
        const [cli, files] = await Promise.all([deps.cli.status(), readClaudeFiles(dir)]);
        const exists = {
          'CLAUDE.local.md': files.claudeLocalMd,
          '.claude/settings.local.json':
            files.settings.some((s) => s.file === '.claude/settings.local.json') || files.unreadable.includes('.claude/settings.local.json'),
        };
        const present = PERSONAL_FILES.filter((file) => exists[file]);
        const gitignore = await Promise.all(present.map(async (file) => ({ file, ignored: await deps.cli.isIgnored(dir, file) })));
        return { cli, files, gitignore, promptRunning: states.get(ctx.project.id)?.run != null };
      },
      readDoc: async (ctx: Ctx, { file }) => deps.docs.read(ctx.project.path, file),
      writeDoc: async (ctx: Ctx, { file, text, version }) => {
        const saved = await deps.docs.write(ctx.project.path, file, text, version);
        deps.logger.info('claude doc saved', { file });
        return saved;
      },
      open: async (ctx: Ctx) => ctx.platform.openTerminal(ctx.project.path, 'claude'),
      continue: async (ctx: Ctx) => ctx.platform.openTerminal(ctx.project.path, 'claude --continue'),
      prompt: (ctx: Ctx, { text }) => startPrompt(ctx, text),
      stopPrompt: async (ctx: Ctx) => {
        const state = states.get(ctx.project.id);
        if (state) await stopRun(state);
      },
      getPromptLogs: async (ctx: Ctx, { afterSeq }) => stateOf(ctx).logs.snapshot(afterSeq),
      clearPromptLogs: async (ctx: Ctx) => {
        stateOf(ctx).logs.clear();
      },
      contextPreview: async (ctx: Ctx) => {
        const current = await deps.docs.read(ctx.project.path, 'CLAUDE.md');
        return { before: current.text, after: applyBlock(current.text, buildBlock(await contextFacts(ctx))), version: current.version };
      },
      applyContext: async (ctx: Ctx, { version }) => {
        const current = await deps.docs.read(ctx.project.path, 'CLAUDE.md');
        if (current.version !== version) throw new NestboxError('CONFLICT', 'The file changed on disk. Reload and try again.');
        const saved = await deps.docs.write(ctx.project.path, 'CLAUDE.md', applyBlock(current.text, buildBlock(await contextFacts(ctx))), version);
        deps.logger.info('claude context applied', { file: 'CLAUDE.md' });
        return saved;
      },
    },
    async dispose() {
      await Promise.all([...states.values()].map((s) => stopRun(s).catch(() => undefined)));
      for (const s of states.values()) s.logs.dispose();
    },
    forgetProject(rootId) {
      for (const [id, s] of states) {
        if (!belongsTo(id, rootId)) continue;
        void stopRun(s).catch(() => undefined);
        s.logs.dispose();
        states.delete(id);
      }
    },
  });
}
