import { describe, expect, it } from 'vitest';
import { ciCheck, depsCheck, envCheck, gitCheck, nodeCheck, overall } from './ready';

const node = (patch: object) => ({
  state: 'ok',
  sources: [],
  requirement: 'nvmrc',
  node: { version: 'v22.11.0', ok: true },
  packageManager: null,
  manager: null,
  fnm: { available: false, on: false, version: null },
  checkedAt: 1,
  ...patch,
});

describe('nodeCheck', () => {
  it('passes when the local Node matches the declared version, fails when it does not', () => {
    expect(nodeCheck(node({}))).toMatchObject({
      tone: 'ok',
      detail: expect.stringContaining('v22.11.0'),
    });
    expect(nodeCheck(node({ node: { version: 'v18.0.0', ok: false } }))).toMatchObject({
      tone: 'fail',
    });
  });

  it('warns without a requirement, and skips what it cannot read', () => {
    expect(
      nodeCheck(node({ requirement: null, node: { version: 'v22.1.0', ok: null } })),
    ).toMatchObject({
      tone: 'warn',
      detail: expect.stringContaining('default'),
    });
    expect(nodeCheck(node({ node: { version: 'v22.1.0', ok: null } }))).toMatchObject({
      tone: 'warn',
    });
    expect(nodeCheck({ nonsense: true })).toMatchObject({ tone: 'skip' });
  });
});

describe('depsCheck', () => {
  const pkg = (projectId: string, severities: string[]) => ({
    projectId,
    relPath: '',
    name: 'shop',
    manager: 'npm',
    checkedAt: 1,
    errors: [],
    rows: severities.map((s, i) => ({
      name: `p${i}`,
      type: 'prod',
      range: '^1',
      current: '1.0.0',
      wanted: '1.0.0',
      latest: '1.0.0',
      outdated: false,
      major: false,
      advisories: [{ id: `a${i}`, title: 't', severity: s, url: null, range: null }],
    })),
  });

  it('warns on high or critical advisories and when never checked', () => {
    expect(
      depsCheck({ packages: [pkg('p1', ['high', 'low'])], checking: false }, 'p1'),
    ).toMatchObject({
      tone: 'warn',
      detail: '1 package with high or critical advisories',
    });
    expect(depsCheck({ packages: [pkg('p1', ['moderate'])], checking: false }, 'p1')).toMatchObject(
      { tone: 'ok' },
    );
    expect(depsCheck({ packages: [], checking: false }, 'p1')).toMatchObject({
      tone: 'warn',
      detail: 'Not checked yet',
    });
    expect(
      depsCheck({ packages: [pkg('other', ['critical'])], checking: false }, 'p1'),
    ).toMatchObject({ tone: 'warn' });
  });
});

describe('envCheck', () => {
  it('fails on keys missing on the platform, naming them', () => {
    expect(
      envCheck(
        { state: 'ok', onlyLocal: ['A', 'B'], onlyRemote: [], both: [] },
        'Vercel',
        'production',
      ),
    ).toEqual({
      kind: 'env',
      label: 'Env',
      tone: 'fail',
      detail: '2 keys missing on Vercel (production): A, B',
    });
    expect(
      envCheck(
        { state: 'ok', onlyLocal: [], onlyRemote: ['X'], both: ['A'] },
        'Vercel',
        'production',
      ),
    ).toMatchObject({
      tone: 'ok',
    });
    expect(envCheck({ state: 'logged-out' }, 'Fly.io', 'app')).toMatchObject({ tone: 'warn' });
  });
});

describe('gitCheck', () => {
  const git = (patch: object) => ({
    state: 'ok',
    branch: 'main',
    detachedAt: null,
    operation: null,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    lastFetchAt: null,
    changes: { total: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, truncated: false },
    files: [],
    lastCommit: null,
    ...patch,
  });

  it('passes when clean and pushed, warns otherwise, skips outside a repository', () => {
    expect(gitCheck(git({}))).toMatchObject({ tone: 'ok' });
    expect(
      gitCheck(
        git({
          ahead: 2,
          changes: {
            total: 3,
            staged: 0,
            unstaged: 3,
            untracked: 0,
            conflicted: 0,
            truncated: false,
          },
        }),
      ),
    ).toMatchObject({ tone: 'warn', detail: '3 uncommitted changes · 2 commits not pushed' });
    expect(gitCheck(git({ upstream: null, ahead: null, behind: null }))).toMatchObject({
      tone: 'warn',
      detail: 'No upstream branch',
    });
    expect(gitCheck({ state: 'not-a-repo' })).toMatchObject({ tone: 'skip' });
  });
});

describe('ciCheck', () => {
  const run = (state: string) => ({
    state: 'ok',
    branch: 'main',
    run: {
      id: '9',
      title: 'Add cart',
      workflow: 'CI',
      branch: 'main',
      sha: 'abc1234',
      event: 'push',
      state,
      createdAt: 1,
      updatedAt: 2,
      url: null,
    },
  });

  it("follows the branch's newest run", () => {
    expect(ciCheck(run('success'))).toMatchObject({
      kind: 'ci',
      label: 'CI',
      tone: 'ok',
      detail: 'CI passed on main (abc1234)',
    });
    expect(ciCheck(run('failure'))).toMatchObject({
      tone: 'fail',
      detail: 'CI failed on main (abc1234)',
    });
    expect(ciCheck(run('running'))).toMatchObject({
      tone: 'warn',
      detail: 'Still running on main (abc1234)',
    });
    expect(ciCheck(run('canceled'))).toMatchObject({ tone: 'warn' });
  });

  it('skips without a run, a provider, a login or the tool', () => {
    expect(ciCheck({ state: 'ok', branch: 'main', run: null })).toMatchObject({
      tone: 'skip',
      detail: 'No CI runs for main yet',
    });
    expect(ciCheck({ state: 'logged-out' })).toMatchObject({
      tone: 'skip',
      detail: 'Not logged in to the CI CLI',
    });
    expect(ciCheck({ state: 'cli-missing' })).toMatchObject({ tone: 'skip' });
    expect(ciCheck(null)).toMatchObject({ tone: 'skip', detail: 'CI not set up' });
  });
});

describe('overall', () => {
  it('is red on a failure, amber on a warning, green otherwise; skips do not count', () => {
    const c = (tone: 'ok' | 'warn' | 'fail' | 'skip') => ({
      kind: 'git' as const,
      label: 'x',
      tone,
      detail: null,
    });
    expect(overall([c('ok'), c('warn'), c('fail')])).toBe('red');
    expect(overall([c('ok'), c('warn'), c('skip')])).toBe('amber');
    expect(overall([c('ok'), c('skip')])).toBe('green');
  });
});
