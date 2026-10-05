// The Deploy tool: the platforms a package deploys to, their recent deployments, and preview and production
// deploys through each platform's own CLI. NestBox keeps no token: the CLI's login is the credential. Only a
// listing or a deploy reaches the network, and each starts from a click.
import type { ChildProcess } from 'node:child_process';
import { NestboxError } from '@shared/errors';
import type { DeployPlatform } from '@shared/detected';
import { belongsTo } from '@shared/processes';
import {
  type EnvCompare,
  type ReadyCheck,
  type Readiness,
  deployContract,
  deployDefinition,
  type DeployResult,
  type DeployStatus,
  type DeployTarget,
  type LastDeploy,
  type Listing,
  PLATFORM_LABELS,
  type PlatformStatus,
} from '@shared/tools/deploy/contract';
import type { Logger } from '../../logger';
import type { PlatformAdapter } from '../../platform/adapter';
import { LineSplitter } from '../../processes/line-splitter';
import { BatchedLog } from '../batched-log';
import { type AnyMainTool, defineMainTool, type ToolContext } from '../types';
import { type Cli, cliCommand, INSTALL, LINK, linkCommand, loginCommand, resolveCli } from './cli';
import { entries, parseEnv } from '../env/dotenv';
import type { EnvFileAccess } from '../env/env-files';
import { ciCheck, depsCheck, envCheck, gitCheck, nodeCheck, overall } from './ready';
import type { ScriptRunResult } from './run-script';
import { configVarKeys, type LocalConfig, readLocalConfig, wranglerEnvironments } from './config';
import {
  parseFlySecrets,
  parseNetlifyEnv,
  parsePagesSecrets,
  parseVercelEnv,
  parseWorkersSecrets,
} from './env-parse';
import {
  classifyFailure,
  deployUrl,
  httpsUrl,
  parseFlyReleases,
  parseNetlifyStatus,
  parsePagesList,
  parseVercelList,
  parseWorkersList,
  productionBranch,
} from './parse';

export interface DeployToolDeps {
  logger: Logger;
  envFiles: Pick<EnvFileAccess, 'list' | 'read'>;
  /** The tool host, for the other tools' results in "Run checks". */
  tools: {
    invoke(toolId: string, projectId: string, method: string, input: unknown): Promise<unknown>;
  };
  /** Starts a script through the Scripts tool and waits for its end. */
  runScript(projectId: string, script: string): Promise<ScriptRunResult>;
  now?: () => number;
  listTimeoutMs?: number;
  deployTimeoutMs?: number;
}

type Ctx = ToolContext<Record<string, never>>;

const LIST_TIMEOUT_MS = 30_000;
export const DEPLOY_TIMEOUT_MS = 20 * 60_000;
const MAX_ROWS = 10;
const LOG_LINES = 5_000;
const OUTPUT_CAP = 4 * 1024 * 1024;
/** Kept for finding the deployment URL; the log keeps the lines themselves. */
const URL_SCAN_CAP = 1024 * 1024;
const PREVIEW_BRANCH = 'nestbox-preview';
/** Pages project names, which reach a command line. */
const PAGES_NAME = /^[a-z0-9][a-z0-9-]{0,57}$/;

interface Run {
  child: ChildProcess;
  stopping: boolean;
  killTree: PlatformAdapter['killTree'];
}

/** Per package (root or workspace): the running deploy, its log, and what listings learned. */
interface PackageState {
  log: BatchedLog;
  action: { platform: DeployPlatform; target: DeployTarget } | null;
  run: Run | null;
  last: LastDeploy | null;
  vercel: { context: string; project: string } | null;
  netlifyAdmin: string | null;
  pagesBranch: string | null;
  ready: Readiness | null;
  checking: boolean;
  emitChanged: () => void;
}

interface Resolved {
  cli: Cli | null;
  local: LocalConfig;
  environments: string[];
}

/** The env file "Env" compares by default: production's own first. */
const DEFAULT_ENV_FILES = ['.env.production', '.env.production.local', '.env'];

async function environmentsOf(
  platform: DeployPlatform,
  local: LocalConfig,
  dir: string,
): Promise<string[]> {
  switch (platform) {
    case 'vercel':
      return ['production', 'preview', 'development'];
    case 'netlify':
      return ['production', 'deploy-preview', 'branch-deploy', 'dev'];
    case 'cloudflare':
      return local.flavour === 'pages'
        ? ['production', 'preview']
        : ['production', ...(await wranglerEnvironments(dir)).filter((n) => n !== 'production')];
    case 'fly':
      return ['app'];
  }
}

const NOT_LINKED_HINT: Record<DeployPlatform, string> = {
  vercel: 'Not linked to a Vercel project yet.',
  netlify: 'Not linked to a Netlify site yet.',
  cloudflare: 'The wrangler config has no name.',
  fly: 'fly.toml has no app name.',
};

function dashboardUrl(
  platform: DeployPlatform,
  local: LocalConfig,
  state: PackageState,
): string | null {
  const name = local.name === null ? null : encodeURIComponent(local.name);
  switch (platform) {
    case 'vercel':
      return state.vercel
        ? httpsUrl(
            `https://vercel.com/${encodeURIComponent(state.vercel.context)}/${encodeURIComponent(state.vercel.project)}`,
          )
        : null;
    case 'netlify':
      return state.netlifyAdmin;
    case 'cloudflare':
      if (name === null) return null;
      return local.flavour === 'pages'
        ? `https://dash.cloudflare.com/?to=/:account/pages/view/${name}`
        : `https://dash.cloudflare.com/?to=/:account/workers/services/view/${name}`;
    case 'fly':
      return name === null ? null : `https://fly.io/apps/${name}`;
  }
}

/** The CLI arguments of a deploy; null when this platform can't do it right now. */
function deployArgs(
  platform: DeployPlatform,
  target: DeployTarget,
  local: LocalConfig,
  state: PackageState,
): string[] | null {
  const prod = target === 'production';
  switch (platform) {
    case 'vercel':
      return ['deploy', '--non-interactive', ...(prod ? ['--prod'] : [])];
    case 'netlify':
      return ['deploy', ...(prod ? ['--prod'] : [])];
    case 'cloudflare':
      if (local.flavour === 'workers') return prod ? ['deploy'] : ['versions', 'upload'];
      if (prod && state.pagesBranch === null) return null;
      return ['pages', 'deploy', '--branch', prod ? (state.pagesBranch as string) : PREVIEW_BRANCH];
    case 'fly':
      return prod ? ['deploy'] : null;
  }
}

function platformStatus(
  platform: DeployPlatform,
  { cli, local, environments }: Resolved,
  state: PackageState,
): PlatformStatus {
  const ready = cli !== null && local.linked;
  const preview = ready && deployArgs(platform, 'preview', local, state) !== null;
  const production = ready && deployArgs(platform, 'production', local, state) !== null;
  let hint: string | null = null;
  if (cli !== null && !local.linked) hint = NOT_LINKED_HINT[platform];
  else if (ready && platform === 'fly')
    hint = 'Fly.io has no preview deploys: Deploy goes to production.';
  else if (ready && !production)
    hint =
      'Production deploys use the branch of the latest production deployment: refresh once one exists.';
  return {
    platform,
    cli: cli === null ? 'missing' : cli.kind,
    install: INSTALL[platform],
    linked: local.linked,
    name: local.name,
    flavour: platform === 'cloudflare' ? local.flavour : null,
    dashboardUrl: dashboardUrl(platform, local, state),
    preview,
    production,
    hint,
    canLink: cli !== null && !local.linked && linkCommand(platform, cli) !== null,
    environments,
  };
}

export function createDeployTool(deps: DeployToolDeps): AnyMainTool {
  const now = deps.now ?? Date.now;
  const states = new Map<string, PackageState>();

  function stateOf(ctx: Ctx): PackageState {
    const emitChanged = () => ctx.emit('changed', undefined);
    const existing = states.get(ctx.project.id);
    if (existing) {
      existing.emitChanged = emitChanged;
      existing.log.emit = (lines) => ctx.emit('logs', { lines });
      return existing;
    }
    const created: PackageState = {
      log: new BatchedLog(LOG_LINES, (lines) => ctx.emit('logs', { lines })),
      action: null,
      run: null,
      last: null,
      vercel: null,
      netlifyAdmin: null,
      pagesBranch: null,
      ready: null,
      checking: false,
      emitChanged,
    };
    states.set(ctx.project.id, created);
    return created;
  }

  function ensurePlatform(ctx: Ctx, platform: DeployPlatform): void {
    if (!ctx.project.deploy.includes(platform))
      throw new NestboxError('NOT_FOUND', 'This package has no config for that platform');
  }

  async function resolve(ctx: Ctx, platform: DeployPlatform): Promise<Resolved> {
    const [cli, local] = await Promise.all([
      resolveCli(platform, ctx.project.path, ctx.project.packageManager, (c) =>
        ctx.platform.commandExists(c),
      ),
      readLocalConfig(platform, ctx.project.path),
    ]);
    return { cli, local, environments: await environmentsOf(platform, local, ctx.project.path) };
  }

  async function env(
    platform: Pick<PlatformAdapter, 'resolveShellEnv'>,
  ): Promise<NodeJS.ProcessEnv> {
    return { ...(await platform.resolveShellEnv()), NO_COLOR: '1', FORCE_COLOR: '0' };
  }

  async function collect(
    ctx: Ctx,
    cli: Cli,
    args: string[],
  ): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
    const { command, args: full } = cliCommand(cli, args);
    let child: ChildProcess;
    try {
      child = ctx.platform.spawnCommand({
        cwd: ctx.project.path,
        command,
        args: full,
        env: await env(ctx.platform),
      });
    } catch {
      return { code: null, stdout: '', stderr: '', timedOut: false };
    }
    return new Promise((resolveRun) => {
      let stdout = '';
      let stderr = '';
      let done = false;
      let timedOut = false;
      const finish = (code: number | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolveRun({ code, stdout, stderr, timedOut });
      };
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < OUTPUT_CAP) stdout += chunk.toString('utf8');
      });
      // Only for classifying a failure: never shown or logged.
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
      });
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid !== undefined) void ctx.platform.killTree(child.pid).catch(() => undefined);
        finish(null);
      }, deps.listTimeoutMs ?? LIST_TIMEOUT_MS);
      child.once('error', () => finish(null));
      child.once('close', (code: number | null) => finish(code));
    });
  }

  function listArgs(platform: DeployPlatform, local: LocalConfig): string[] | null {
    switch (platform) {
      case 'vercel':
        return ['list', '--format', 'json', '--limit', String(MAX_ROWS), '--non-interactive'];
      case 'netlify':
        return ['status', '--json'];
      case 'cloudflare':
        if (local.flavour === 'workers') return ['deployments', 'list', '--json'];
        return local.name !== null && PAGES_NAME.test(local.name)
          ? ['pages', 'deployment', 'list', '--project-name', local.name, '--json']
          : null;
      case 'fly':
        return ['releases', '--json'];
    }
  }

  async function list(ctx: Ctx, platform: DeployPlatform): Promise<Listing> {
    ensurePlatform(ctx, platform);
    const state = stateOf(ctx);
    const { cli, local } = await resolve(ctx, platform);
    if (cli === null) return { state: 'cli-missing' };
    // Unlinked, `vercel list` lists every project of the team: never run it then.
    const args = local.linked ? listArgs(platform, local) : null;
    if (args === null) return { state: 'not-linked' };
    const started = now();
    const r = await collect(ctx, cli, args);
    const listing = interpret(platform, local, state, r);
    deps.logger.info('deploy list', {
      projectId: ctx.project.id,
      platform,
      state: listing.state,
      code: r.code ?? 'none',
      ms: now() - started,
    });
    return listing;
  }

  function interpret(
    platform: DeployPlatform,
    local: LocalConfig,
    state: PackageState,
    r: { code: number | null; stdout: string; stderr: string; timedOut: boolean },
  ): Listing {
    if (r.timedOut) return { state: 'timeout' };
    const failed = (): Listing => ({
      state: classifyFailure(platform, `${r.stdout}\n${r.stderr}`),
    });
    const learn = (apply: () => boolean) => {
      if (apply()) state.emitChanged();
    };
    switch (platform) {
      case 'vercel': {
        const parsed = r.code === 0 ? parseVercelList(r.stdout) : null;
        if (!parsed) return failed();
        const project = local.name ?? parsed.project;
        learn(() => {
          if (parsed.context === null || project === null) return false;
          const changed =
            state.vercel?.context !== parsed.context || state.vercel.project !== project;
          state.vercel = { context: parsed.context, project };
          return changed;
        });
        return { state: 'ok', deployments: parsed.deployments.slice(0, MAX_ROWS) };
      }
      case 'netlify': {
        const parsed = parseNetlifyStatus(r.stdout);
        if (!parsed) return failed();
        if (parsed.state === 'site')
          learn(() => {
            const changed = state.netlifyAdmin !== parsed.adminUrl;
            state.netlifyAdmin = parsed.adminUrl;
            return changed;
          });
        return parsed;
      }
      case 'cloudflare': {
        if (local.flavour === 'workers') {
          const parsed =
            r.code === 0 ? parseWorkersList(r.stdout, dashboardUrl(platform, local, state)) : null;
          return parsed ? { state: 'ok', deployments: parsed.slice(0, MAX_ROWS) } : failed();
        }
        const parsed = r.code === 0 ? parsePagesList(r.stdout) : null;
        if (!parsed) return failed();
        learn(() => {
          const branch = productionBranch(parsed);
          const changed = branch !== state.pagesBranch;
          state.pagesBranch = branch;
          return changed;
        });
        return { state: 'ok', deployments: parsed.slice(0, MAX_ROWS) };
      }
      case 'fly': {
        const logs =
          local.name === null
            ? null
            : `https://fly.io/apps/${encodeURIComponent(local.name)}/monitoring`;
        const parsed = r.code === 0 ? parseFlyReleases(r.stdout, logs) : null;
        return parsed ? { state: 'ok', deployments: parsed.slice(0, MAX_ROWS) } : failed();
      }
    }
  }

  async function kill(run: Run | null): Promise<void> {
    if (!run || run.stopping) return;
    run.stopping = true;
    if (run.child.pid !== undefined) await run.killTree(run.child.pid).catch(() => undefined);
  }

  async function deploy(
    ctx: Ctx,
    platform: DeployPlatform,
    target: DeployTarget,
  ): Promise<DeployResult> {
    ensurePlatform(ctx, platform);
    const state = stateOf(ctx);
    const { cli, local } = await resolve(ctx, platform);
    const args = cli !== null && local.linked ? deployArgs(platform, target, local, state) : null;
    if (cli === null || args === null)
      throw new NestboxError('VALIDATION', "This deploy isn't available");
    if (state.action)
      throw new NestboxError('CONFLICT', 'A deploy is already running for this package');

    const { command, args: full } = cliCommand(cli, args);
    state.action = { platform, target };
    state.emitChanged();
    const started = now();
    state.log.push('system', `▸ ${[command, ...full].join(' ')}`);
    let child: ChildProcess | null = null;
    try {
      child = ctx.platform.spawnCommand({
        cwd: ctx.project.path,
        command,
        args: full,
        env: await env(ctx.platform),
      });
    } catch {
      child = null;
    }
    let code: number | null = null;
    let timedOut = false;
    let canceled = false;
    let scanned = '';
    if (child) {
      const run: Run = { child, stopping: false, killTree: (pid) => ctx.platform.killTree(pid) };
      state.run = run;
      const splitters = { stdout: new LineSplitter(), stderr: new LineSplitter() };
      const take = (stream: 'stdout' | 'stderr', lines: string[]) => {
        for (const line of lines) {
          state.log.push(stream, line);
          if (scanned.length < URL_SCAN_CAP) scanned += `${line}\n`;
        }
      };
      for (const stream of ['stdout', 'stderr'] as const)
        child[stream]?.on('data', (chunk: Buffer) => take(stream, splitters[stream].push(chunk)));
      const timer = setTimeout(() => {
        timedOut = true;
        void kill(run);
      }, deps.deployTimeoutMs ?? DEPLOY_TIMEOUT_MS);
      code = await new Promise<number | null>((resolveRun) => {
        let ended = false;
        const end = (c: number | null) => {
          if (ended) return;
          ended = true;
          for (const stream of ['stdout', 'stderr'] as const)
            take(stream, splitters[stream].flush(true));
          resolveRun(c);
        };
        child?.once('error', () => end(null));
        child?.once('close', (c: number | null) => end(c));
      });
      clearTimeout(timer);
      canceled = run.stopping && !timedOut;
      if (run.stopping) code = null;
      state.run = null;
    }
    const ok = code === 0;
    const url = ok ? deployUrl(platform, scanned) : null;
    state.log.push(
      'system',
      timedOut
        ? '■ timed out'
        : canceled
          ? '■ canceled'
          : child === null
            ? `■ couldn't start ${PLATFORM_LABELS[platform]}'s CLI`
            : ok
              ? '■ done'
              : `■ exited with code ${code ?? 'unknown'}`,
    );
    deps.logger.info('deploy', {
      projectId: ctx.project.id,
      platform,
      target,
      code: code ?? 'none',
      ms: now() - started,
    });
    state.action = null;
    state.last = { platform, target, ok, url, at: now() };
    if (states.get(ctx.project.id) === state) state.emitChanged();
    return { ok, code, url };
  }

  async function forget(predicate: (id: string) => boolean): Promise<void> {
    const gone = [...states].filter(([id]) => predicate(id));
    for (const [id] of gone) states.delete(id);
    await Promise.all(
      gone.map(async ([, s]) => {
        await kill(s.run);
        s.log.dispose();
      }),
    );
  }

  function envArgs(
    platform: DeployPlatform,
    local: LocalConfig,
    environment: string,
  ): string[] | null {
    switch (platform) {
      case 'vercel':
        return ['env', 'ls', environment, '--format', 'json', '--non-interactive'];
      case 'netlify':
        return ['env:list', '--json', '--context', environment];
      case 'cloudflare':
        if (local.flavour === 'workers')
          return [
            'secret',
            'list',
            '--format',
            'json',
            ...(environment === 'production' ? [] : ['--env', environment]),
          ];
        return local.name !== null && PAGES_NAME.test(local.name)
          ? ['pages', 'secret', 'list', '--project-name', local.name, '--env', environment]
          : null;
      case 'fly':
        return ['secrets', 'list', '--json'];
    }
  }

  function parseKeys(
    platform: DeployPlatform,
    local: LocalConfig,
    environment: string,
    text: string,
  ): string[] | null {
    switch (platform) {
      case 'vercel':
        return parseVercelEnv(text, environment);
      case 'netlify':
        return parseNetlifyEnv(text);
      case 'cloudflare':
        return local.flavour === 'workers' ? parseWorkersSecrets(text) : parsePagesSecrets(text);
      case 'fly':
        return parseFlySecrets(text);
    }
  }

  /** The key names of one env file in the package folder; null when it isn't there. Values are dropped here. */
  async function localKeys(ctx: Ctx, file: string): Promise<string[] | null> {
    const listed = await deps.envFiles.list(ctx.project.path);
    if (!listed.some((f) => f.name === file)) return null;
    try {
      const { text } = await deps.envFiles.read(ctx.project.path, file);
      return [...entries(parseEnv(text)).keys()];
    } catch {
      return null;
    }
  }

  async function envCompare(
    ctx: Ctx,
    {
      platform,
      environment,
      file,
    }: { platform: DeployPlatform; environment: string; file: string },
  ): Promise<EnvCompare> {
    ensurePlatform(ctx, platform);
    const { cli, local, environments } = await resolve(ctx, platform);
    if (!environments.includes(environment))
      throw new NestboxError('VALIDATION', 'This platform has no such environment');
    if (cli === null) return { state: 'cli-missing' };
    const args = local.linked ? envArgs(platform, local, environment) : null;
    if (args === null) return { state: 'not-linked' };
    const mine = await localKeys(ctx, file);
    if (mine === null) return { state: 'no-file' };
    const started = now();
    const r = await collect(ctx, cli, args);
    // The output may hold values (Vercel, Netlify): only the keys are kept, and r goes out of scope here.
    const parsed =
      r.timedOut || r.code !== 0 ? null : parseKeys(platform, local, environment, r.stdout);
    let result: EnvCompare;
    if (r.timedOut) result = { state: 'timeout' };
    else if (parsed === null)
      result = { state: classifyFailure(platform, `${r.stdout}\n${r.stderr}`) };
    else {
      const remote = new Set([
        ...parsed,
        ...(await configVarKeys(platform, ctx.project.path, environment)),
      ]);
      const localSet = new Set(mine);
      const sorted = (keys: Iterable<string>) => [...keys].sort();
      result = {
        state: 'ok',
        onlyLocal: sorted(mine.filter((k) => !remote.has(k))),
        onlyRemote: sorted([...remote].filter((k) => !localSet.has(k))),
        both: sorted(mine.filter((k) => remote.has(k))),
      };
    }
    deps.logger.info('deploy env compare', {
      projectId: ctx.project.id,
      platform,
      state: result.state,
      ...(result.state === 'ok'
        ? {
            onlyLocal: result.onlyLocal.length,
            onlyRemote: result.onlyRemote.length,
            both: result.both.length,
          }
        : {}),
      code: r.code ?? 'none',
      ms: now() - started,
    });
    return result;
  }

  const defaultEnvFile = (files: string[]) =>
    DEFAULT_ENV_FILES.find((f) => files.includes(f)) ?? files[0] ?? null;

  async function invokeOrNull(
    ctx: Ctx,
    toolId: string,
    method: string,
    projectId = ctx.project.id,
  ): Promise<unknown> {
    try {
      return await deps.tools.invoke(toolId, projectId, method, {});
    } catch {
      return null;
    }
  }

  /** Env vs the first platform that can compare: its first environment, the default env file. */
  async function readyEnvCheck(ctx: Ctx): Promise<ReadyCheck> {
    const files = (await deps.envFiles.list(ctx.project.path)).map((f) => f.name);
    const file = defaultEnvFile(files);
    for (const platform of ctx.project.deploy) {
      const { cli, local, environments } = await resolve(ctx, platform);
      const environment = environments[0];
      if (cli === null || !local.linked || environment === undefined) continue;
      if (file === null) return { kind: 'env', label: 'Env', tone: 'skip', detail: 'No env file' };
      try {
        const compare = await envCompare(ctx, { platform, environment, file });
        return envCheck(compare, PLATFORM_LABELS[platform], environment);
      } catch {
        return {
          kind: 'env',
          label: 'Env',
          tone: 'warn',
          detail: `Couldn't compare with ${PLATFORM_LABELS[platform]}`,
        };
      }
    }
    return { kind: 'env', label: 'Env', tone: 'skip', detail: 'No platform ready to compare with' };
  }

  function scriptCheck(script: string, r: ScriptRunResult): ReadyCheck {
    const check = (tone: ReadyCheck['tone'], detail: string): ReadyCheck => ({
      kind: 'script',
      label: script,
      tone,
      detail,
    });
    switch (r.outcome) {
      case 'exited':
        return r.code === 0
          ? check('ok', 'Exited with code 0')
          : check('fail', `Exited with code ${r.code ?? '?'}`);
      case 'crashed':
        return check('fail', r.code === null ? "Couldn't start" : `Exited with code ${r.code}`);
      case 'stopped':
        return check('fail', 'Stopped before it finished');
      case 'busy':
        return check('fail', 'Already running: stop it first');
      case 'timeout':
        return check('fail', 'Timed out and stopped');
      case 'failed':
        return check('fail', "Couldn't start");
    }
  }

  async function checkReady(ctx: Ctx, scripts: string[]): Promise<Readiness> {
    const known = ctx.project.packageJson?.scripts ?? {};
    if (scripts.some((s) => !Object.hasOwn(known, s)))
      throw new NestboxError('VALIDATION', "That script isn't in package.json");
    const state = stateOf(ctx);
    if (state.checking)
      throw new NestboxError('CONFLICT', 'Checks are already running for this package');
    state.checking = true;
    const started = now();
    const pending = (kind: ReadyCheck['kind'], label: string): ReadyCheck => ({
      kind,
      label,
      tone: 'pending',
      detail: null,
    });
    const checks: ReadyCheck[] = [
      pending('node', 'Node'),
      pending('deps', 'Dependencies'),
      pending('env', 'Env'),
      pending('git', 'Git'),
      pending('ci', 'CI'),
      ...[...new Set(scripts)].map((s) => pending('script', s)),
    ];
    const publish = () => {
      state.ready = { at: started, overall: null, checks: [...checks] };
      state.emitChanged();
    };
    const set = (i: number, check: ReadyCheck) => {
      checks[i] = check;
      publish();
    };
    const running = (i: number) => set(i, { ...(checks[i] as ReadyCheck), tone: 'running' });
    try {
      publish();
      running(0);
      set(0, nodeCheck(await invokeOrNull(ctx, 'node', 'status')));
      running(1);
      set(1, depsCheck(await invokeOrNull(ctx, 'deps', 'results'), ctx.project.id));
      running(2);
      set(2, await readyEnvCheck(ctx));
      running(3);
      set(
        3,
        ctx.project.git === null
          ? { kind: 'git', label: 'Git', tone: 'skip', detail: 'Not a git repository' }
          : gitCheck(await invokeOrNull(ctx, 'git', 'status')),
      );
      running(4);
      // CI belongs to the repository: a workspace package asks its root.
      set(4, ciCheck(await invokeOrNull(ctx, 'ci', 'latest', ctx.project.rootId)));
      for (let i = 5; i < checks.length; i++) {
        const script = (checks[i] as ReadyCheck).label;
        running(i);
        set(i, scriptCheck(script, await deps.runScript(ctx.project.id, script)));
      }
      state.ready = { at: started, overall: overall(checks), checks: [...checks] };
      deps.logger.info('deploy ready check', {
        projectId: ctx.project.id,
        overall: state.ready.overall ?? 'none',
        checks: checks.length,
        ms: now() - started,
      });
      return state.ready;
    } finally {
      state.checking = false;
      state.emitChanged();
    }
  }

  const handlers = {
    async status(ctx: Ctx): Promise<DeployStatus> {
      const state = stateOf(ctx);
      const [platforms, files] = await Promise.all([
        Promise.all(
          ctx.project.deploy.map(async (p) => platformStatus(p, await resolve(ctx, p), state)),
        ),
        deps.envFiles.list(ctx.project.path),
      ]);
      const envFiles = files.map((f) => f.name);
      return {
        platforms,
        action: state.action,
        last: state.last,
        envFiles,
        defaultEnvFile: defaultEnvFile(envFiles),
        elsewhere: ctx.project.workspaces
          .filter((w) => w.deploy.length > 0)
          .map((w) => ({ projectId: w.id, name: w.name, platforms: w.deploy })),
        scripts: Object.keys(ctx.project.packageJson?.scripts ?? {}),
        ready: state.ready,
      };
    },
    checkReady: (ctx: Ctx, { scripts }: { scripts: string[] }) => checkReady(ctx, scripts),
    envCompare: (
      ctx: Ctx,
      input: { platform: DeployPlatform; environment: string; file: string },
    ) => envCompare(ctx, input),
    deployments: (ctx: Ctx, { platform }: { platform: DeployPlatform }) => list(ctx, platform),
    deploy: (ctx: Ctx, { platform, target }: { platform: DeployPlatform; target: DeployTarget }) =>
      deploy(ctx, platform, target),
    async cancel(ctx: Ctx) {
      await kill(states.get(ctx.project.id)?.run ?? null);
    },
    async login(ctx: Ctx, { platform }: { platform: DeployPlatform }) {
      ensurePlatform(ctx, platform);
      const { cli } = await resolve(ctx, platform);
      if (cli === null)
        throw new NestboxError('NOT_FOUND', `${PLATFORM_LABELS[platform]}'s CLI isn't installed`);
      await ctx.platform.openTerminal(ctx.project.path, loginCommand(platform, cli));
    },
    async link(ctx: Ctx, { platform }: { platform: DeployPlatform }) {
      // Linking is also how a package without a config gets one (it writes .vercel / .netlify).
      if (!ctx.project.deploy.includes(platform) && LINK[platform] === undefined) ensurePlatform(ctx, platform);
      const { cli } = await resolve(ctx, platform);
      const command = cli === null ? null : linkCommand(platform, cli);
      if (command === null)
        throw new NestboxError('VALIDATION', "This platform can't be linked from NestBox");
      await ctx.platform.openTerminal(ctx.project.path, command);
    },
    getLogs: async (ctx: Ctx, { afterSeq }: { afterSeq?: number }) =>
      stateOf(ctx).log.snapshot(afterSeq),
    clearLogs: async (ctx: Ctx) => stateOf(ctx).log.clear(),
  };

  return defineMainTool({
    ...deployDefinition,
    contract: deployContract,
    handlers,
    busy: () => [...states.values()].some((s) => s.action !== null || s.checking),
    async dispose() {
      await forget(() => true);
    },
    forgetProject(rootId) {
      void forget((id) => belongsTo(id, rootId));
    },
  });
}
