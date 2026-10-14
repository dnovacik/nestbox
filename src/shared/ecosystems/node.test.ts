import { describe, expect, it } from 'vitest';
import { type NodeInfo, nodeOf, packageManagerLabel } from './node';

const info: NodeInfo = {
  name: 'shop',
  scripts: { dev: 'vite' },
  packageManager: 'pnpm',
  packageManagerSource: 'lockfile',
  lockfiles: ['pnpm-lock.yaml'],
  framework: { id: 'vite', major: 7 },
  ports: [5173],
  hasDependencies: true,
  monorepo: null,
};

describe('nodeOf', () => {
  it('returns the node entry parsed', () => {
    expect(
      nodeOf({
        ecosystems: [
          { id: 'dotnet', info: {} },
          { id: 'node', info },
        ],
      }),
    ).toEqual(info);
  });

  it('is null without a node entry or with an invalid one', () => {
    expect(nodeOf({ ecosystems: [] })).toBeNull();
    expect(nodeOf({ ecosystems: [{ id: 'node', info: { packageManager: 'npm' } }] })).toBeNull();
    expect(nodeOf({ ecosystems: [{ id: 'node', info: null }] })).toBeNull();
  });

  it('parses an info object once', () => {
    const project = { ecosystems: [{ id: 'node' as const, info: { ...info } }] };
    expect(nodeOf(project)).toBe(nodeOf(project));
  });
});

describe('packageManagerLabel', () => {
  it('marks npm as the default when nothing names a manager', () => {
    expect(
      packageManagerLabel({ ...info, packageManager: 'npm', packageManagerSource: 'default' }),
    ).toBe('npm (default)');
    expect(packageManagerLabel(info)).toBe('pnpm');
    expect(packageManagerLabel({ ...info, packageManagerSource: 'packageManager' })).toBe('pnpm');
  });
});
