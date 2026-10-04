import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkPackage, fallbackOutdated, mergeRows, readDirect, type Run, type RunResult, updateCommand } from './check';

const fixture = (name: string) => readFile(join(__dirname, '__fixtures__', name), 'utf8');
const ok = (stdout: string, code = 0): RunResult => ({ code, stdout, timedOut: false });

async function pkg(json: Record<string, unknown>, installed: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'nestbox-deps-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', ...json }));
  for (const [name, version] of Object.entries(installed)) {
    await mkdir(join(dir, 'node_modules', ...name.split('/')), { recursive: true });
    await writeFile(join(dir, 'node_modules', ...name.split('/'), 'package.json'), JSON.stringify({ name, version }));
  }
  return dir;
}

function fakeRun(answers: Record<string, RunResult>) {
  return vi.fn<Run>(async (command, args) => answers[`${command} ${args.join(' ')}`] ?? { code: null, stdout: '', timedOut: false });
}

const DEMO = { dependencies: { lodash: '4.17.15', ms: '^2.0.0' }, devDependencies: { semver: '~6.3.0' } };
const INSTALLED = { lodash: '4.17.15', ms: '2.1.3', semver: '6.3.1' };

describe('readDirect', () => {
  it('lists dependencies by type, first field wins, and drops names unsafe for a command line', async () => {
    const dir = await pkg({
      dependencies: { react: '^18', '@scope/ui': '1.0.0', 'bad name': '1', '--force': '1' },
      devDependencies: { vitest: '^3' },
      peerDependencies: { react: '>=17' },
    });
    expect(await readDirect(dir)).toEqual([
      { name: 'react', type: 'prod', range: '^18' },
      { name: '@scope/ui', type: 'prod', range: '1.0.0' },
      { name: 'vitest', type: 'dev', range: '^3' },
    ]);
  });
});

describe('checkPackage', () => {
  it('reads npm results (exit 1 on findings is still a result) and merges them into rows', async () => {
    const dir = await pkg(DEMO, INSTALLED);
    const run = fakeRun({
      'npm outdated --json': ok(await fixture('npm-outdated.json'), 1),
      'npm audit --json': ok(await fixture('npm-audit.json'), 1),
    });
    const { rows, errors } = await checkPackage(dir, 'npm', run);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.name, r.type, r.current, r.latest, r.outdated, r.major, r.advisories.length])).toEqual([
      ['lodash', 'prod', '4.17.15', '4.18.1', true, false, 2],
      ['ms', 'prod', '2.1.3', null, false, false, 0],
      ['semver', 'dev', '6.3.1', '7.8.5', true, true, 0],
    ]);
  });

  it('runs pnpm and Yarn 1 with their own flags', async () => {
    const dir = await pkg(DEMO, INSTALLED);
    const pnpm = fakeRun({
      'pnpm outdated --format json': ok(await fixture('pnpm-outdated.json'), 1),
      'pnpm audit --json': ok(await fixture('pnpm-audit.json'), 1),
    });
    expect((await checkPackage(dir, 'pnpm', pnpm)).rows.filter((r) => r.outdated)).toHaveLength(2);
    const yarn = fakeRun({
      'yarn --version': ok('1.22.22\n'),
      'yarn outdated --json': ok(await fixture('yarn1-outdated.jsonl'), 1),
      'yarn audit --json': ok(await fixture('yarn1-audit.jsonl'), 12),
    });
    const result = await checkPackage(dir, 'yarn', yarn);
    expect(result.errors).toEqual([]);
    expect(result.rows.find((r) => r.name === 'lodash')?.advisories).toHaveLength(2);
  });

  it('uses the registry through Yarn 2+ for outdated, and its npm audit', async () => {
    const dir = await pkg(DEMO, INSTALLED);
    const info = (versions: string[], latest: string) => ok(JSON.stringify({ name: 'x', versions, 'dist-tags': { latest } }));
    const run = fakeRun({
      'yarn --version': ok('4.18.1'),
      'yarn npm info lodash --fields versions,dist-tags --json': info(['4.17.15', '4.17.21', '4.18.1'], '4.18.1'),
      'yarn npm info ms --fields versions,dist-tags --json': info(['2.1.2', '2.1.3'], '2.1.3'),
      'yarn npm info semver --fields versions,dist-tags --json': info(['6.3.1', '7.8.5'], '7.8.5'),
      'yarn npm audit --json': ok(await fixture('berry-audit.jsonl'), 1),
    });
    const { rows, errors } = await checkPackage(dir, 'yarn', run);
    expect(errors).toEqual([]);
    expect(rows.find((r) => r.name === 'lodash')).toMatchObject({ wanted: '4.17.15', latest: '4.18.1', outdated: true, major: false });
    expect(rows.find((r) => r.name === 'ms')).toMatchObject({ outdated: false });
    expect(rows.find((r) => r.name === 'semver')).toMatchObject({ wanted: '6.3.1', latest: '7.8.5', major: true });
  });

  it('reports a failed or timed-out step and keeps the rest', async () => {
    const dir = await pkg(DEMO, INSTALLED);
    const run = fakeRun({
      'npm outdated --json': ok('npm ERR! code ENOTFOUND', 1),
      'npm audit --json': { code: null, stdout: '', timedOut: true },
    });
    const { rows, errors } = await checkPackage(dir, 'npm', run);
    expect(errors).toEqual([
      { step: 'outdated', code: 'failed' },
      { step: 'audit', code: 'timeout' },
    ]);
    expect(rows.map((r) => r.name)).toEqual(['lodash', 'ms', 'semver']);
  });
});

describe('fallbackOutdated', () => {
  it('asks Bun for versions and tags, skips non-semver specs, and fails when the registry is unreachable', async () => {
    const direct = [
      { name: 'lodash', type: 'prod' as const, range: '^4.17.0' },
      { name: 'local', type: 'prod' as const, range: 'workspace:*' },
      { name: 'git', type: 'prod' as const, range: 'github:a/b' },
    ];
    const run = fakeRun({
      'bun pm view lodash versions --json': ok('["4.17.15","4.18.1"]'),
      'bun pm view lodash dist-tags --json': ok('{"latest":"4.18.1"}'),
    });
    expect(await fallbackOutdated('bun', direct, new Map([['lodash', '4.17.15']]), run)).toEqual([
      { name: 'lodash', current: '4.17.15', wanted: '4.18.1', latest: '4.18.1' },
    ]);
    expect(run.mock.calls.map(([, args]) => args[2])).toEqual(['lodash', 'lodash']);
    expect(await fallbackOutdated('bun', direct, new Map(), fakeRun({}))).toBeNull();
  });
});

describe('mergeRows', () => {
  it('adds vulnerable transitive packages as their own rows', () => {
    const vulns = new Map([['qs', [{ id: 'GHSA-1', title: 'qs', severity: 'high' as const, url: null, range: '<6' }]]]);
    expect(mergeRows([{ name: 'express', type: 'prod', range: '^4' }], new Map([['express', '4.21.0']]), [], vulns)).toEqual([
      expect.objectContaining({ name: 'express', outdated: false, advisories: [] }),
      expect.objectContaining({ name: 'qs', type: null, range: null, current: null, advisories: vulns.get('qs') }),
    ]);
  });
});

describe('updateCommand', () => {
  it('spells the update per package manager', () => {
    expect(updateCommand('npm', 'vitest', 'dev')).toBe('npm install -D vitest@latest');
    expect(updateCommand('pnpm', 'react', 'prod')).toBe('pnpm add react@latest');
    expect(updateCommand('yarn', 'react', 'prod')).toBe('yarn upgrade react@latest');
    expect(updateCommand('yarn-berry', 'react', 'dev')).toBe('yarn up react@latest');
    expect(updateCommand('bun', 'vitest', 'dev')).toBe('bun add -d vitest@latest');
  });
});
