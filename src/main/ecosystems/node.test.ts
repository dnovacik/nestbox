import { describe, expect, it } from 'vitest';
import { nodeModule } from './node';

function info(packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm') {
  return { packageManager };
}

describe('nodeModule.detect', () => {
  it('detects pnpm projects', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml']);
    expect(await nodeModule.detect('/test', files, new Set())).toEqual({ packageManager: 'pnpm' });
  });

  it('detects npm projects', async () => {
    const files = new Set(['package.json', 'package-lock.json']);
    expect(await nodeModule.detect('/test', files, new Set())).toEqual({ packageManager: 'npm' });
  });

  it('detects yarn projects', async () => {
    const files = new Set(['package.json', 'yarn.lock']);
    expect(await nodeModule.detect('/test', files, new Set())).toEqual({ packageManager: 'yarn' });
  });

  it('detects bun projects', async () => {
    const files = new Set(['package.json', 'bun.lockb']);
    expect(await nodeModule.detect('/test', files, new Set())).toEqual({ packageManager: 'bun' });
  });

  it('defaults to npm when there is no lockfile', async () => {
    const files = new Set(['package.json']);
    expect(await nodeModule.detect('/test', files, new Set())).toEqual({ packageManager: 'npm' });
  });

  it('prefers pnpm over the other lockfiles', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
    expect((await nodeModule.detect('/test', files, new Set()))?.packageManager).toBe('pnpm');
  });

  it('returns null without package.json', async () => {
    expect(await nodeModule.detect('/test', new Set(['README.md']), new Set())).toBeNull();
  });
});

describe('nodeModule.tasks', () => {
  it('offers install and ci for pnpm', () => {
    expect(nodeModule.tasks(info('pnpm'))).toEqual([
      { name: 'install', argv: ['pnpm', 'install'], title: 'Install dependencies' },
      { name: 'ci', argv: ['pnpm', 'install', '--frozen-lockfile'], title: 'Clean install from the lockfile' },
    ]);
  });

  it('uses npm ci for npm', () => {
    expect(nodeModule.tasks(info('npm'))).toContainEqual({
      name: 'ci',
      argv: ['npm', 'ci'],
      title: 'Clean install from the lockfile',
    });
  });

  it('never mirrors package.json script names', () => {
    // dev, build, start and test belong to package.json: a detected task with one of those
    // names would lose the uniqueness check and never show.
    const names = nodeModule.tasks(info()).map((t) => t.name);
    expect(names).not.toContain('dev');
    expect(names).not.toContain('build');
    expect(names).not.toContain('test');
    expect(names).not.toContain('start');
  });
});

describe('nodeModule.summary', () => {
  it('names the package manager', () => {
    expect(nodeModule.summary?.(info('yarn'))).toBe('Node.js · yarn');
  });
});