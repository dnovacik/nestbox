import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeployPlatform } from '@shared/detected';
import type { LogSnapshot } from '@shared/processes';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type {
  DeployResult,
  DeployStatus,
  EnvCompare,
  Listing,
} from '@shared/tools/deploy/contract';
import { createMemoryLogger } from '../../logger';
import { type FakeChild, fakePlatform, flushIo } from '../../processes/fake-child';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createEnvFileAccess } from '../env/env-files';
import { createDeployTool } from './index';

type SpawnArgs = { cwd: string; command: string; args: string[]; env: NodeJS.ProcessEnv };
type Answer = { code: number | null; stdout?: string; stderr?: string } | 'hold';
const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

let tool: AnyMainTool | null = null;
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nestbox-deploy-tool-'));
  mkdirSync(join(dir, '.git'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

const LINKED: Record<string, string> = {
  '.vercel/project.json': JSON.stringify({
    projectId: 'prj_1',
    orgId: 'team_1',
    projectName: 'shop',
  }),
  '.netlify/state.json': JSON.stringify({ siteId: 'abc-123' }),
  'fly.toml': "app = 'shop-api'\n",
  'wrangler.toml': 'name = "site"\npages_build_output_dir = "dist"\n',
};

/** answers: by the CLI arguments joined with spaces (after the CLI itself). 'hold' leaves the child running. */
function setup(
  opts: {
    files?: Record<string, string>;
    deploy?: DeployPlatform[];
    answers?: Record<string, Answer>;
    installed?: (command: string) => boolean | null;
    deployTimeoutMs?: number;
  } = {},
) {
  const dir = tree(opts.files ?? LINKED);
  const base = fakePlatform();
  const answers = opts.answers ?? {};
  const spawnCommand = vi.fn((o: SpawnArgs) => {
    const child = fakePlatform().spawnCommand() as unknown as FakeChild;
    base.children.push(child);
    const answer = answers[o.args.join(' ')] ?? { code: 1, stderr: 'unexpected command' };
    if (answer !== 'hold') {
      queueMicrotask(() => {
        if (answer.stdout) child.stdout.write(answer.stdout);
        if (answer.stderr) child.stderr.write(answer.stderr);
        child.exit(answer.code);
      });
    }
    return child;
  });
  const openTerminal = vi.fn(async () => undefined);
  const commandExists = vi.fn(async (c: string) => (opts.installed ? opts.installed(c) : true));
  const platform = { ...base, spawnCommand, openTerminal, commandExists };
  const logger = createMemoryLogger();
  tool = createDeployTool({
    logger,
    envFiles: createEnvFileAccess(),
    now: () => 5_000,
    ...(opts.deployTimeoutMs === undefined ? {} : { deployTimeoutMs: opts.deployTimeoutMs }),
  });
  const emit = vi.fn();
  const ctx = {
    project: makeDetectedForTest({
      path: dir,
      packageManager: 'npm',
      deploy: opts.deploy ?? ['vercel', 'netlify', 'cloudflare', 'fly'],
    }),
    shared: createSharedContext().forProject('p1'),
    emit,
    platform,
    settings: { get: () => ({}), update: (fn: (s: object) => object) => fn({}) },
  } as unknown as ToolContext;
  const call = <T>(method: string, input: unknown = {}) =>
    tool?.handlers[method]?.(ctx, input) as Promise<T>;
  const spawned = () =>
    (spawnCommand.mock.calls as [SpawnArgs][]).map(([o]) => [o.command, ...o.args].join(' '));
  return { call, emit, logger, spawned, spawnCommand, openTerminal, children: base.children, dir };
}

describe('deploy tool: status', () => {
  it('reports every platform from local files and PATH, without running any command', async () => {
    const { call, spawned } = setup();
    const status = await call<DeployStatus>('status');
    expect(spawned()).toEqual([]);
    expect(status.action).toBeNull();
    expect(
      status.platforms.map((p) => [p.platform, p.cli, p.linked, p.name, p.preview, p.production]),
    ).toEqual([
      ['vercel', 'global', true, 'shop', true, true],
      ['netlify', 'global', true, null, true, true],
      ['cloudflare', 'global', true, 'site', true, false],
      ['fly', 'global', true, 'shop-api', false, true],
    ]);
    const byPlatform = Object.fromEntries(status.platforms.map((p) => [p.platform, p]));
    expect(byPlatform['cloudflare']).toMatchObject({
      flavour: 'pages',
      dashboardUrl: 'https://dash.cloudflare.com/?to=/:account/pages/view/site',
      hint: expect.stringContaining('production deployment'),
    });
    expect(byPlatform['fly']).toMatchObject({
      dashboardUrl: 'https://fly.io/apps/shop-api',
      hint: expect.any(String),
    });
    expect(byPlatform['vercel']?.dashboardUrl).toBeNull();
  });

  it('offers install, link and nothing else when the CLI is missing or the package is not linked', async () => {
    const { call } = setup({
      files: { 'vercel.json': '{}', 'netlify.toml': '' },
      deploy: ['vercel', 'netlify'],
      installed: (c) => c !== 'netlify',
    });
    const [vercel, netlify] = (await call<DeployStatus>('status')).platforms;
    expect(vercel).toMatchObject({
      cli: 'global',
      linked: false,
      preview: false,
      production: false,
      canLink: true,
    });
    expect(netlify).toMatchObject({
      cli: 'missing',
      install: 'npm i -g netlify-cli',
      canLink: false,
      preview: false,
    });
  });
});

describe('deploy tool: listing', () => {
  it('lists Vercel deployments and learns the dashboard link', async () => {
    const { call, spawned, emit } = setup({
      answers: {
        'list --format json --limit 10 --non-interactive': {
          code: 0,
          stdout: fixture('vercel-list.json'),
        },
      },
    });
    const listing = await call<Listing>('deployments', { platform: 'vercel' });
    expect(spawned()).toEqual(['vercel list --format json --limit 10 --non-interactive']);
    expect(listing.state === 'ok' && listing.deployments.map((d) => d.state)).toEqual([
      'building',
      'ready',
      'error',
    ]);
    expect(emit).toHaveBeenCalledWith('changed', undefined);
    const vercel = (await call<DeployStatus>('status')).platforms[0];
    expect(vercel?.dashboardUrl).toBe('https://vercel.com/acme/shop');
  });

  it('runs the CLI in the package folder with the shell env and no colours', async () => {
    const { call, spawnCommand, dir } = setup({
      answers: { 'releases --json': { code: 0, stdout: fixture('fly-releases.json') } },
    });
    await call('deployments', { platform: 'fly' });
    const [o] = spawnCommand.mock.calls[0] as [SpawnArgs];
    expect(o.cwd).toBe(dir);
    expect(o.command).toBe('flyctl');
    expect(o.env).toMatchObject({ PATH: 'x', NO_COLOR: '1' });
  });

  it('learns the Pages production branch, which enables production', async () => {
    const { call, spawned } = setup({
      answers: {
        'pages deployment list --project-name site --json': {
          code: 0,
          stdout: fixture('pages-deployments.json'),
        },
      },
    });
    await call('deployments', { platform: 'cloudflare' });
    expect(spawned()).toEqual(['wrangler pages deployment list --project-name site --json']);
    const cloudflare = (await call<DeployStatus>('status')).platforms[2];
    expect(cloudflare).toMatchObject({ production: true, hint: null });
  });

  it('shows the Netlify site instead of a deploy list', async () => {
    const { call } = setup({
      answers: { 'status --json': { code: 0, stdout: fixture('netlify-status.json') } },
    });
    expect(await call<Listing>('deployments', { platform: 'netlify' })).toMatchObject({
      state: 'site',
      adminUrl: 'https://app.netlify.com/projects/shop-acme',
    });
    expect((await call<DeployStatus>('status')).platforms[1]?.dashboardUrl).toBe(
      'https://app.netlify.com/projects/shop-acme',
    );
    const loggedOut = setup({
      answers: { 'status --json': { code: 1, stdout: fixture('netlify-status-logged-out.json') } },
    });
    expect(await loggedOut.call('deployments', { platform: 'netlify' })).toEqual({
      state: 'logged-out',
    });
  });

  it('classifies failures from stderr, never returning the CLI text', async () => {
    const { call } = setup({
      answers: {
        'releases --json': {
          code: 1,
          stderr: 'Error: no access token available. Please login with `flyctl auth login`',
        },
        'list --format json --limit 10 --non-interactive': {
          code: 1,
          stderr: 'Error: something odd for dana@example.com',
        },
      },
    });
    expect(await call('deployments', { platform: 'fly' })).toEqual({ state: 'logged-out' });
    expect(await call('deployments', { platform: 'vercel' })).toEqual({ state: 'failed' });
  });

  it('never lists an unlinked Vercel project (the CLI would list the whole team)', async () => {
    const { call, spawned } = setup({ files: { 'vercel.json': '{}' }, deploy: ['vercel'] });
    expect(await call('deployments', { platform: 'vercel' })).toEqual({ state: 'not-linked' });
    expect(spawned()).toEqual([]);
  });

  it('answers cli-missing, and NOT_FOUND for a platform the package does not have', async () => {
    const { call } = setup({ deploy: ['fly'], installed: () => false });
    expect(await call('deployments', { platform: 'fly' })).toEqual({ state: 'cli-missing' });
    await expect(call('deployments', { platform: 'vercel' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('deploy tool: deploying', () => {
  it('deploys a preview, streams the output into the log and keeps the URL', async () => {
    const { call, spawned, emit } = setup({
      answers: {
        'deploy --non-interactive': {
          code: 0,
          stdout:
            'Inspect: https://vercel.com/acme/shop/abc\nPreview: https://shop-git-x-acme.vercel.app\n',
        },
      },
    });
    const result = await call<DeployResult>('deploy', { platform: 'vercel', target: 'preview' });
    expect(result).toEqual({ ok: true, code: 0, url: 'https://shop-git-x-acme.vercel.app' });
    expect(spawned()).toEqual(['vercel deploy --non-interactive']);
    await flushIo();
    const log = await call<LogSnapshot>('getLogs', {});
    expect(log.lines.map((l) => l.text)).toEqual([
      '▸ vercel deploy --non-interactive',
      'Inspect: https://vercel.com/acme/shop/abc',
      'Preview: https://shop-git-x-acme.vercel.app',
      '■ done',
    ]);
    expect((await call<DeployStatus>('status')).last).toEqual({
      platform: 'vercel',
      target: 'preview',
      ok: true,
      url: 'https://shop-git-x-acme.vercel.app',
      at: 5_000,
    });
    expect(emit).toHaveBeenCalledWith('changed', undefined);
  });

  it('uses each platform’s production command', async () => {
    const answers: Record<string, Answer> = {
      'deploy --non-interactive --prod': { code: 0 },
      'deploy --prod': { code: 0 },
      deploy: { code: 0 },
      'pages deployment list --project-name site --json': {
        code: 0,
        stdout: fixture('pages-deployments.json'),
      },
      'pages deploy --branch main': { code: 0 },
    };
    const { call, spawned } = setup({ answers });
    for (const platform of ['vercel', 'netlify', 'fly'] as const)
      await call('deploy', { platform, target: 'production', confirmed: true });
    await call('deployments', { platform: 'cloudflare' });
    await call('deploy', { platform: 'cloudflare', target: 'production', confirmed: true });
    expect(spawned()).toEqual([
      'vercel deploy --non-interactive --prod',
      'netlify deploy --prod',
      'flyctl deploy',
      'wrangler pages deployment list --project-name site --json',
      'wrangler pages deploy --branch main',
    ]);
  });

  it('uploads a Worker version for a preview and deploys it for production', async () => {
    const { call, spawned } = setup({
      files: { 'wrangler.toml': 'name = "api"\n' },
      deploy: ['cloudflare'],
      answers: { 'versions upload': { code: 0 }, deploy: { code: 0 } },
    });
    await call('deploy', { platform: 'cloudflare', target: 'preview' });
    await call('deploy', { platform: 'cloudflare', target: 'production', confirmed: true });
    expect(spawned()).toEqual(['wrangler versions upload', 'wrangler deploy']);
  });

  it('refuses what the status does not offer: Fly previews, Pages production before a listing', async () => {
    const { call, spawned } = setup();
    await expect(call('deploy', { platform: 'fly', target: 'preview' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      call('deploy', { platform: 'cloudflare', target: 'production', confirmed: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(spawned()).toEqual([]);
  });

  it('runs one deploy per package at a time, and Cancel stops it', async () => {
    const { call, children } = setup({ answers: { 'deploy --non-interactive': 'hold' } });
    const first = call<DeployResult>('deploy', { platform: 'vercel', target: 'preview' });
    await flushIo();
    expect((await call<DeployStatus>('status')).action).toEqual({
      platform: 'vercel',
      target: 'preview',
    });
    await expect(call('deploy', { platform: 'netlify', target: 'preview' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await call('cancel', {});
    expect(await first).toEqual({ ok: false, code: null, url: null });
    expect(children).toHaveLength(1);
    expect((await call<DeployStatus>('status')).action).toBeNull();
    const log = await call<LogSnapshot>('getLogs', {});
    expect(log.lines.at(-1)?.text).toBe('■ canceled');
  });

  it('times out a deploy that never ends', async () => {
    const { call } = setup({ answers: { 'deploy --prod': 'hold' }, deployTimeoutMs: 20 });
    expect(
      await call('deploy', { platform: 'netlify', target: 'production', confirmed: true }),
    ).toEqual({
      ok: false,
      code: null,
      url: null,
    });
    expect((await call<LogSnapshot>('getLogs', {})).lines.at(-1)?.text).toBe('■ timed out');
  });

  it('logs platforms, targets and codes, never names, URLs or output', async () => {
    const { call, logger } = setup({
      answers: {
        'deploy --non-interactive': {
          code: 0,
          stdout: 'Preview: https://shop-git-x-acme.vercel.app\n',
        },
        'list --format json --limit 10 --non-interactive': {
          code: 0,
          stdout: fixture('vercel-list.json'),
        },
      },
    });
    await call('deploy', { platform: 'vercel', target: 'preview' });
    await call('deployments', { platform: 'vercel' });
    const text = JSON.stringify(logger.entries);
    expect(text).toContain('deploy');
    expect(text).not.toMatch(/vercel\.app|acme|shop|Preview/);
  });
});

describe('deploy tool: terminals', () => {
  it('opens the login and link commands in a terminal in the package folder', async () => {
    const { call, openTerminal, dir } = setup({
      files: { 'vercel.json': '{}', 'fly.toml': 'app = "x"' },
    });
    await call('login', { platform: 'fly' });
    await call('link', { platform: 'vercel' });
    expect(openTerminal.mock.calls).toEqual([
      [dir, 'flyctl auth login'],
      [dir, 'vercel link'],
    ]);
    await expect(call('link', { platform: 'fly' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('deploy tool: env vs production', () => {
  const ENV_FILES = {
    ...LINKED,
    '.env': 'DATABASE_URL=postgres://local\nSTRIPE_SECRET=sk_test_hunter2\n',
    '.env.production': 'DATABASE_URL=postgres://prod-local\nLOCAL_ONLY=1\n',
  };

  it('offers the environments and env files, preselecting production and .env.production', async () => {
    const { call } = setup({
      files: { ...ENV_FILES, 'wrangler.toml': 'name = "api"\n[env.staging]\n' },
    });
    const status = await call<DeployStatus>('status');
    expect(status.envFiles).toEqual(['.env', '.env.production']);
    expect(status.defaultEnvFile).toBe('.env.production');
    expect(status.platforms.map((p) => [p.platform, p.environments])).toEqual([
      ['vercel', ['production', 'preview', 'development']],
      ['netlify', ['production', 'deploy-preview', 'branch-deploy', 'dev']],
      ['cloudflare', ['production', 'staging']],
      ['fly', ['app']],
    ]);
  });

  it('compares key names, never values, and logs only counts', async () => {
    const { call, spawned, logger } = setup({
      files: ENV_FILES,
      answers: {
        'env ls production --format json --non-interactive': {
          code: 0,
          stdout: fixture('vercel-env.json'),
        },
      },
    });
    const result = await call<EnvCompare>('envCompare', {
      platform: 'vercel',
      environment: 'production',
      file: '.env.production',
    });
    expect(spawned()).toEqual(['vercel env ls production --format json --non-interactive']);
    expect(result).toEqual({
      state: 'ok',
      onlyLocal: ['LOCAL_ONLY'],
      onlyRemote: ['STRIPE_SECRET'],
      both: ['DATABASE_URL'],
    });
    const text = JSON.stringify([result, logger.entries]);
    expect(text).not.toMatch(/hunter2|postgres|prod-local/);
    expect(JSON.stringify(logger.entries)).not.toMatch(/DATABASE_URL|LOCAL_ONLY/);
  });

  it('adds the variables the config itself deploys (fly.toml [env], wrangler vars)', async () => {
    const { call, spawned } = setup({
      files: {
        '.env': 'PORT=3000\nDATABASE_URL=x\nSECRET_KEY_BASE=y\n',
        'fly.toml': "app = 'shop-api'\n[env]\n  PORT = '8080'\n",
        'wrangler.toml': 'name = "api"\n[env.staging.vars]\nPORT = "1"\n',
      },
      answers: {
        'secrets list --json': { code: 0, stdout: fixture('fly-secrets.json') },
        'secret list --format json --env staging': {
          code: 0,
          stdout: fixture('workers-secrets.json'),
        },
      },
    });
    expect(await call('envCompare', { platform: 'fly', environment: 'app', file: '.env' })).toEqual(
      {
        state: 'ok',
        onlyLocal: [],
        onlyRemote: [],
        both: ['DATABASE_URL', 'PORT', 'SECRET_KEY_BASE'],
      },
    );
    expect(
      await call('envCompare', { platform: 'cloudflare', environment: 'staging', file: '.env' }),
    ).toMatchObject({
      onlyLocal: ['DATABASE_URL', 'SECRET_KEY_BASE'],
      onlyRemote: ['API_KEY', 'SESSION_SECRET'],
      both: ['PORT'],
    });
    expect(spawned()).toEqual([
      'flyctl secrets list --json',
      'wrangler secret list --format json --env staging',
    ]);
  });

  it('uses each platform’s command for the environment', async () => {
    const { call, spawned } = setup({
      files: ENV_FILES,
      answers: {
        'env:list --json --context deploy-preview': {
          code: 0,
          stdout: fixture('netlify-env.json'),
        },
        'pages secret list --project-name site --env preview': {
          code: 0,
          stdout: fixture('pages-secrets.txt'),
        },
      },
    });
    await call('envCompare', { platform: 'netlify', environment: 'deploy-preview', file: '.env' });
    await call('envCompare', { platform: 'cloudflare', environment: 'preview', file: '.env' });
    expect(spawned()).toEqual([
      'netlify env:list --json --context deploy-preview',
      'wrangler pages secret list --project-name site --env preview',
    ]);
  });

  it('refuses environments the platform does not offer and missing files; reports failures', async () => {
    const { call, spawned } = setup({
      files: ENV_FILES,
      answers: { 'secrets list --json': { code: 1, stderr: 'Error: no access token available' } },
    });
    await expect(
      call('envCompare', { platform: 'vercel', environment: 'staging', file: '.env' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(
      await call('envCompare', {
        platform: 'vercel',
        environment: 'production',
        file: '.env.local',
      }),
    ).toEqual({
      state: 'no-file',
    });
    expect(await call('envCompare', { platform: 'fly', environment: 'app', file: '.env' })).toEqual(
      {
        state: 'logged-out',
      },
    );
    expect(spawned()).toEqual(['flyctl secrets list --json']);
  });
});
