import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  cleanLine,
  ghState,
  glabState,
  parseGhJobs,
  parseGhRuns,
  parseGlabJobs,
  parseGlabPipelines,
  tailGhLog,
  tailTrace,
} from './parse';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('GitHub', () => {
  it('reads `gh run list --json` (gh 2.89)', () => {
    const runs = parseGhRuns(fixture('gh-run-list.json'));
    expect(runs).not.toBeNull();
    expect(runs?.length).toBeGreaterThan(0);
    const first = runs?.[0];
    expect(first).toMatchObject({
      id: '37265766370',
      workflow: 'CI',
      branch: 'v2-projects-ux',
      sha: '138ef04',
      event: 'pull_request',
      state: 'success',
      url: 'https://github.com/dnovacik/nestbox/actions/runs/37265766370',
    });
    expect(first?.createdAt).toBe(Date.parse('2026-10-05T04:58:34Z'));
    expect(runs?.some((r) => r.state === 'failure')).toBe(true);
  });

  it('maps statuses and conclusions', () => {
    expect(ghState('in_progress', '')).toBe('running');
    expect(ghState('queued', '')).toBe('queued');
    expect(ghState('waiting', '')).toBe('queued');
    expect(ghState('completed', 'timed_out')).toBe('failure');
    expect(ghState('completed', 'startup_failure')).toBe('failure');
    expect(ghState('completed', 'cancelled')).toBe('canceled');
    expect(ghState('completed', 'neutral')).toBe('skipped');
    expect(ghState('completed', 'action_required')).toBe('manual');
    expect(ghState('completed', 'stale')).toBe('unknown');
  });

  it('reads the jobs of a run with the first failed step', () => {
    const jobs = parseGhJobs(fixture('gh-run-view-jobs.json'));
    const failed = jobs?.find((j) => j.state === 'failure');
    expect(failed).toMatchObject({
      id: '111621264152',
      name: 'e2e (macos-latest)',
      stage: null,
      allowFailure: false,
      failedStep: 'Run pnpm e2e',
    });
    expect(jobs?.filter((j) => j.state === 'failure')).toHaveLength(2);
  });

  it('keeps the log text of `--log-failed` without the job, step and timestamp columns', () => {
    const tail = tailGhLog(fixture('gh-log-failed.txt'), 200);
    expect(tail.truncated).toBe(false);
    expect(tail.lines[0]).toBe('##[group]Run pnpm e2e');
    expect(tail.lines[1]).toBe('pnpm e2e');
    expect(tail.lines).toContain('  1 failed');
    expect(tail.lines.at(-1)).toBe('##[error]Process completed with exit code 1.');
  });

  it('keeps only the last lines', () => {
    const tail = tailGhLog(fixture('gh-log-failed.txt'), 2);
    expect(tail).toEqual({
      truncated: true,
      lines: [
        ' ELIFECYCLE  Command failed with exit code 1.',
        '##[error]Process completed with exit code 1.',
      ],
    });
  });

  it('refuses output that is not the expected JSON', () => {
    expect(parseGhRuns('not json')).toBeNull();
    expect(parseGhRuns('{"a":1}')).toBeNull();
    expect(parseGhJobs('[]')).toBeNull();
  });
});

describe('GitLab', () => {
  it('reads `glab ci list --output json`', () => {
    const runs = parseGlabPipelines(fixture('glab-ci-list.json'));
    expect(runs?.map((r) => [r.id, r.branch, r.state])).toEqual([
      ['2081234567', 'main', 'running'],
      ['2081230001', 'feature/cart', 'failure'],
      ['2081220002', 'main', 'success'],
      ['2081210003', 'main', 'queued'],
    ]);
    expect(runs?.[1]).toMatchObject({
      title: 'Fix cart totals',
      workflow: null,
      sha: '77aa88b',
      event: 'merge_request_event',
      url: 'https://gitlab.com/acme/shop/-/pipelines/2081230001',
    });
    // Only https URLs leave main.
    expect(runs?.[3]?.url).toBeNull();
  });

  it('maps pipeline and job statuses', () => {
    expect(glabState('created')).toBe('queued');
    expect(glabState('preparing')).toBe('queued');
    expect(glabState('scheduled')).toBe('queued');
    expect(glabState('failed')).toBe('failure');
    expect(glabState('canceled')).toBe('canceled');
    expect(glabState('manual')).toBe('manual');
    expect(glabState('whatever')).toBe('unknown');
  });

  it('reads the jobs of `glab ci get --output json`, with allow_failure, and drops the user', () => {
    const jobs = parseGlabJobs(fixture('glab-ci-get.json'));
    expect(jobs?.map((j) => [j.id, j.name, j.stage, j.state, j.allowFailure])).toEqual([
      ['8812340001', 'build', 'build', 'success', false],
      ['8812340002', 'unit tests', 'test', 'failure', false],
      ['8812340003', 'lint', 'test', 'failure', true],
      ['8812340004', 'deploy', 'deploy', 'skipped', false],
    ]);
    expect(JSON.stringify(jobs)).not.toContain('A Developer');
  });

  it('strips ANSI codes and section markers from a trace', () => {
    const tail = tailTrace(fixture('glab-ci-trace.txt'), 200);
    expect(tail.lines).toEqual([
      'Running with gitlab-runner 17.4.0 (b92ee590)',
      'Preparing the "docker" executor',
      '$ pnpm test',
      ' FAIL  src/cart.test.ts > totals > adds tax',
      'AssertionError: expected 108 to be 110',
      'Cleaning up project directory and file based variables',
      'ERROR: Job failed: exit code 1',
    ]);
  });
});

describe('cleanLine', () => {
  it('drops escape sequences and carriage returns', () => {
    expect(cleanLine('\x1b[1;31mred\x1b[0m\r')).toBe('red');
    expect(cleanLine('a\x1b]8;;https://x\x07link\x1b]8;;\x07b')).toBe('alinkb');
  });
});

describe('classifyFailure', () => {
  it('recognises a missing login', () => {
    expect(classifyFailure('To get started with GitHub CLI, please run:  gh auth login')).toBe(
      'logged-out',
    );
    expect(classifyFailure('HTTP 401: Bad credentials')).toBe('logged-out');
    expect(classifyFailure('glab: 401 Unauthorized')).toBe('logged-out');
    expect(
      classifyFailure(
        'none of the git remotes configured for this repository point to a known GitHub host',
      ),
    ).toBe('no-remote');
    expect(classifyFailure('no git remotes found')).toBe('no-remote');
    expect(classifyFailure('HTTP 500')).toBe('failed');
  });
});
