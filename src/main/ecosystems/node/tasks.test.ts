import { describe, expect, it } from 'vitest';
import type { NodeInfo } from './detect';
import { nodeInfo } from './fixtures';
import { nodeTasks } from './tasks';

function info(packageManager: NodeInfo['packageManager'] = 'npm'): NodeInfo {
  return nodeInfo({ packageManager });
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

  it("runs an Nx project's targets through the root's nx", () => {
    const tasks = nodeTasks(
      nodeInfo({ packageManager: 'pnpm', nx: { project: '@acme/ui', targets: ['build', 'lint'] } }),
    );
    expect(tasks.filter((t) => t.name.startsWith('nx:'))).toEqual([
      {
        name: 'nx:build',
        argv: ['pnpm', 'exec', 'nx', 'run', '@acme/ui:build'],
        title: 'nx run @acme/ui:build',
      },
      {
        name: 'nx:lint',
        argv: ['pnpm', 'exec', 'nx', 'run', '@acme/ui:lint'],
        title: 'nx run @acme/ui:lint',
      },
    ]);
  });

  it('offers no install in a project without its own package.json', () => {
    const names = nodeTasks(
      nodeInfo({ packageJson: false, nx: { project: 'ui', targets: ['test'] } }),
    ).map((t) => t.name);
    expect(names).toEqual(['nx:test']);
  });

  it("keeps the root's run-many over its own project target of the same name", () => {
    const tasks = nodeTasks(
      nodeInfo({
        nx: { project: 'acme', targets: ['build', 'e2e'] },
        monorepo: { shared: [], turbo: [], yarnBerry: false, nx: ['build'] },
      }),
    );
    expect(tasks.filter((t) => t.name.startsWith('nx:')).map((t) => t.argv.slice(-3))).toEqual([
      ['run-many', '-t', 'build'],
      ['nx', 'run', 'acme:e2e'],
    ]);
  });
});
