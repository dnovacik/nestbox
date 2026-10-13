import { describe, expect, it } from 'vitest';
import type { NodeInfo } from './detect';
import { nodeTasks } from './tasks';

function info(packageManager: NodeInfo['packageManager'] = 'npm'): NodeInfo {
  return { packageManager, packageManagerSource: 'lockfile', lockfiles: [] };
}

describe('nodeTasks', () => {
  it('offers install and ci for pnpm', () => {
    expect(nodeTasks(info('pnpm'))).toEqual([
      { name: 'install', argv: ['pnpm', 'install'], title: 'Install dependencies' },
      {
        name: 'ci',
        argv: ['pnpm', 'install', '--frozen-lockfile'],
        title: 'Clean install from the lockfile',
      },
    ]);
  });

  it('uses npm ci for npm', () => {
    expect(nodeTasks(info('npm'))).toContainEqual({
      name: 'ci',
      argv: ['npm', 'ci'],
      title: 'Clean install from the lockfile',
    });
  });

  it('never mirrors package.json script names', () => {
    // dev, build, start and test belong to package.json: a detected task with one of those
    // names would lose the uniqueness check and never show.
    const names = nodeTasks(info()).map((t) => t.name);
    expect(names).not.toContain('dev');
    expect(names).not.toContain('build');
    expect(names).not.toContain('test');
    expect(names).not.toContain('start');
  });
});
