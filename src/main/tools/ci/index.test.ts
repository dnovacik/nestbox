import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { CiJobs, CiLatest, CiLog, CiRuns, CiStatus } from '@shared/tools/ci/contract';
import { createMemoryLogger } from '../../logger';
import { type FakeChild, fakePlatform } from '../../processes/fake-child';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createCiTool } from './index';

type SpawnArgs = { cwd: string; command: string; args: string[]; env: NodeJS.ProcessEnv };
type Answer = { code: number | null; stdout?: string; stderr?: string } | 'hold';
const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

const GH_FIELDS =
  'databaseId,status,conclusion,workflowName,displayTitle,headBranch,headSha,event,createdAt,updatedAt,url';

let tool: AnyMainTool | null = null;
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
});

function repo(remote: string | null, branch = 'v2-projects-ux'): string {
  const dir = mkdtempSync(join(tmpdir(), 'nestbox-ci-tool-'));
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  writeFileSync(
    join(dir, '.git', 'config'),
    remote === null ? '[core]\n' : `[remote "origin"]\n\turl = ${remote}\n`,
  );
  return dir;
}

/** answers: by `<command> <args…>`. */
function setup(
  opts: {
    remote?: string | null;
    branch?: string;
    answers?: Record<string, Answer>;
    installed?: boolean | null;
  } = {},
) {
  const dir = repo(
    opts.remote === undefined ? 'git@github.com:dnovacik/nestbox.git' : opts.remote,
    opts.branch,
  );
  const base = fakePlatform();
  const answers = opts.answers ?? {};
  const spawnCommand = vi.fn((o: SpawnArgs) => {
    const child = fakePlatform().spawnCommand() as unknown as FakeChild;
    base.children.push(child);
    const answer = answers[[o.command, ...o.args].join(' ')] ?? { code: 1, stderr: 'unexpected' };
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
  const commandExists = vi.fn(async () => (opts.installed === undefined ? true : opts.installed));
  const platform = { ...base, spawnCommand, openTerminal, commandExists };
  const logger = createMemoryLogger();
  tool = createCiTool({ logger, now: () => 1_000 });
  const emit = vi.fn();
  const ctx = {
    project: makeDetectedForTest({ path: dir, git: { branch: 'main', head: null } }),
    shared: createSharedContext().forProject('p1'),
    emit,
    platform,
    settings: { get: () => ({}), update: (fn: (s: object) => object) => fn({}) },
  } as unknown as ToolContext;
  const call = <T>(method: string, input: unknown = {}) =>
    tool?.handlers[method]?.(ctx, input) as Promise<T>;
  return { call, spawnCommand, openTerminal, emit, logger, dir };
}

const ghList = (branch: string) => `gh run list --limit 15 --json ${GH_FIELDS} --branch ${branch}`;

describe('status', () => {
  it('reads the provider, the CLI and the live branch without running anything', async () => {
    const { call, spawnCommand } = setup();
    const status = await call<CiStatus>('status');
    expect(status).toEqual({
      provider: 'github',
      cli: 'found',
      install: 'https://cli.github.com',
      loginCommand: 'gh auth login',
      branch: 'v2-projects-ux',
      latest: null,
      busy: false,
    });
    expect(spawnCommand).not.toHaveBeenCalled();
  });

  it('says when there is no provider or no CLI', async () => {
    expect((await setup({ remote: null }).call<CiStatus>('status')).provider).toBeNull();
    const gitlab = await setup({
      remote: 'https://gitlab.com/a/b',
      installed: false,
    }).call<CiStatus>('status');
    expect(gitlab).toMatchObject({
      provider: 'gitlab',
      cli: 'missing',
      loginCommand: 'glab auth login',
    });
  });
});

describe('runs', () => {
  it("lists the branch's runs through gh and remembers the newest", async () => {
    const { call, emit, logger } = setup({
      answers: { [ghList('v2-projects-ux')]: { code: 0, stdout: fixture('gh-run-list.json') } },
    });
    const runs = await call<CiRuns>('runs', { scope: 'branch' });
    expect(runs.state).toBe('ok');
    if (runs.state !== 'ok') return;
    expect(runs.branch).toBe('v2-projects-ux');
    expect(runs.runs[0]?.id).toBe('37265766370');
    expect((await call<CiStatus>('status')).latest?.id).toBe('37265766370');
    expect(emit).toHaveBeenCalledWith('changed', undefined);
    // Logs carry ids and counts, never branches or titles.
    const logged = JSON.stringify(logger.entries);
    expect(logged).toContain('"count"');
    expect(logged).not.toContain('v2-projects-ux');
    expect(logged).not.toContain('sidebar groups');
  });

  it('lists every branch without --branch', async () => {
    const { call, spawnCommand } = setup({
      answers: {
        [`gh run list --limit 15 --json ${GH_FIELDS}`]: {
          code: 0,
          stdout: fixture('gh-run-list.json'),
        },
      },
    });
    expect((await call<CiRuns>('runs', { scope: 'all' })).state).toBe('ok');
    expect(spawnCommand.mock.calls[0]?.[0].args).not.toContain('--branch');
  });

  it('never passes an unusual branch name: it lists more and filters in main', async () => {
    const { call, spawnCommand } = setup({
      branch: 'feat/100%done',
      answers: {
        [`gh run list --limit 100 --json ${GH_FIELDS}`]: {
          code: 0,
          stdout: fixture('gh-run-list.json'),
        },
      },
    });
    const runs = await call<CiRuns>('runs', { scope: 'branch' });
    expect(runs).toEqual({ state: 'ok', branch: 'feat/100%done', filtered: true, runs: [] });
    expect(spawnCommand.mock.calls[0]?.[0].args.join(' ')).not.toContain('100%done');
  });

  it("filters GitLab's pipelines by ref in main", async () => {
    const { call } = setup({
      remote: 'git@gitlab.com:acme/shop.git',
      branch: 'main',
      answers: {
        'glab ci list --per-page 50 --output json': {
          code: 0,
          stdout: fixture('glab-ci-list.json'),
        },
      },
    });
    const runs = await call<CiRuns>('runs', { scope: 'branch' });
    expect(runs.state === 'ok' && runs.runs.map((r) => r.id)).toEqual([
      '2081234567',
      '2081220002',
      '2081210003',
    ]);
  });

  it('classifies failures from stderr without passing it on', async () => {
    const { call, logger } = setup({
      answers: {
        [ghList('v2-projects-ux')]: {
          code: 4,
          stderr: 'To get started with GitHub CLI, please run:  gh auth login',
        },
      },
    });
    expect(await call<CiRuns>('runs', { scope: 'branch' })).toEqual({ state: 'logged-out' });
    expect(JSON.stringify(logger.entries)).not.toContain('get started');
    expect(await setup({ installed: false }).call<CiRuns>('runs', { scope: 'all' })).toEqual({
      state: 'cli-missing',
    });
    expect(await setup({ remote: null }).call<CiRuns>('runs', { scope: 'all' })).toEqual({
      state: 'no-provider',
    });
    const garbage = setup({ answers: { [ghList('v2-projects-ux')]: { code: 0, stdout: 'oops' } } });
    expect(await garbage.call<CiRuns>('runs', { scope: 'branch' })).toEqual({ state: 'failed' });
  });
});

describe('jobs and logs', () => {
  const view = 'gh run view 37265470317 --json jobs';

  it("lists a run's jobs", async () => {
    const { call } = setup({
      answers: { [view]: { code: 0, stdout: fixture('gh-run-view-jobs.json') } },
    });
    const jobs = await call<CiJobs>('jobs', { runId: '37265470317' });
    expect(jobs.state === 'ok' && jobs.jobs.filter((j) => j.state === 'failure').length).toBe(2);
  });

  it("tails a failed job's log, only for a job of that run", async () => {
    const { call, spawnCommand } = setup({
      answers: {
        [view]: { code: 0, stdout: fixture('gh-run-view-jobs.json') },
        'gh run view --job 111621264152 --log-failed': {
          code: 0,
          stdout: fixture('gh-log-failed.txt'),
        },
      },
    });
    const log = await call<CiLog>('jobLog', { runId: '37265470317', jobId: '111621264152' });
    expect(log.state === 'ok' && log.lines.at(-1)).toBe(
      '##[error]Process completed with exit code 1.',
    );
    expect(await call<CiLog>('jobLog', { runId: '37265470317', jobId: '999' })).toEqual({
      state: 'failed',
    });
    expect(spawnCommand.mock.calls.filter((c) => c[0].args.includes('--log-failed'))).toHaveLength(
      1,
    );
  });

  it("never traces a GitLab job that's still running (glab would follow it)", async () => {
    const running = JSON.stringify({
      jobs: [{ id: 5, name: 'test', stage: 'test', status: 'running', allow_failure: false }],
    });
    const { call, spawnCommand } = setup({
      remote: 'https://gitlab.com/a/b',
      answers: { 'glab ci get --pipeline-id 7 --output json': { code: 0, stdout: running } },
    });
    expect(await call<CiLog>('jobLog', { runId: '7', jobId: '5' })).toEqual({ state: 'failed' });
    expect(spawnCommand).toHaveBeenCalledTimes(1);
  });

  it('traces a finished GitLab job', async () => {
    const { call } = setup({
      remote: 'https://gitlab.com/a/b',
      answers: {
        'glab ci get --pipeline-id 2081230001 --output json': {
          code: 0,
          stdout: fixture('glab-ci-get.json'),
        },
        'glab ci trace 8812340002': { code: 0, stdout: fixture('glab-ci-trace.txt') },
      },
    });
    const log = await call<CiLog>('jobLog', { runId: '2081230001', jobId: '8812340002' });
    expect(log.state === 'ok' && log.lines).toContain('AssertionError: expected 108 to be 110');
  });
});

describe('rerunFailed', () => {
  it('re-runs the failed jobs of a GitHub run', async () => {
    const { call, spawnCommand } = setup({
      answers: {
        'gh run view 37265470317 --json jobs': {
          code: 0,
          stdout: fixture('gh-run-view-jobs.json'),
        },
        'gh run rerun 37265470317 --failed': { code: 0 },
      },
    });
    expect(await call('rerunFailed', { runId: '37265470317' })).toEqual({ ok: true, retried: 2 });
    expect(spawnCommand.mock.calls.at(-1)?.[0].args).toEqual([
      'run',
      'rerun',
      '37265470317',
      '--failed',
    ]);
  });

  it("retries each failed GitLab job that isn't allowed to fail", async () => {
    const { call, spawnCommand } = setup({
      remote: 'https://gitlab.com/a/b',
      answers: {
        'glab ci get --pipeline-id 2081230001 --output json': {
          code: 0,
          stdout: fixture('glab-ci-get.json'),
        },
        'glab ci retry 8812340002': { code: 0 },
      },
    });
    expect(await call('rerunFailed', { runId: '2081230001' })).toEqual({ ok: true, retried: 1 });
    expect(spawnCommand.mock.calls.map((c) => c[0].args.join(' '))).not.toContain(
      'ci retry 8812340003',
    );
  });

  it('runs one re-run per project at a time', async () => {
    const { call } = setup({ answers: { 'gh run view 1 --json jobs': 'hold' } });
    const first = call('rerunFailed', { runId: '1' });
    await expect(call('rerunFailed', { runId: '1' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(tool?.busy?.()).toBe(true);
    void first.catch(() => undefined);
  });
});

describe('latest and login', () => {
  it("answers the branch's newest run", async () => {
    const { call } = setup({
      answers: { [ghList('v2-projects-ux')]: { code: 0, stdout: fixture('gh-run-list.json') } },
    });
    const latest = await call<CiLatest>('latest');
    expect(latest).toMatchObject({
      state: 'ok',
      branch: 'v2-projects-ux',
      run: { id: '37265766370' },
    });
  });

  it("opens the CLI's login in a terminal", async () => {
    const { call, openTerminal, dir } = setup();
    await call('login');
    expect(openTerminal).toHaveBeenCalledWith(dir, 'gh auth login');
    await expect(setup({ installed: false }).call('login')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
