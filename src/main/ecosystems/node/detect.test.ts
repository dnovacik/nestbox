import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectNode } from './detect';
import { detectPackageManager } from './package-manager';

describe('detectNode', () => {
  it('detects pnpm projects', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'pnpm', packageManagerSource: 'lockfile' });
  });

  it('detects npm projects', async () => {
    const files = new Set(['package.json', 'package-lock.json']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'npm', packageManagerSource: 'lockfile' });
  });

  it('detects yarn projects', async () => {
    const files = new Set(['package.json', 'yarn.lock']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'yarn', packageManagerSource: 'lockfile' });
  });

  it('detects bun projects', async () => {
    const files = new Set(['package.json', 'bun.lockb']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'bun', packageManagerSource: 'lockfile' });
  });

  it('defaults to npm when there is no lockfile', async () => {
    const files = new Set(['package.json']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'npm', packageManagerSource: 'default' });
  });

  it('prefers pnpm over the other lockfiles', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
    expect((await detectNode('/test', files, new Set()))?.packageManager).toBe('pnpm');
  });

  it('detects bun from the text lockfile', async () => {
    const files = new Set(['package.json', 'bun.lock']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'bun', packageManagerSource: 'lockfile' });
  });

  it('picks the same manager as the scripts when several lockfiles exist', async () => {
    const files = new Set(['package.json', 'yarn.lock', 'bun.lockb']);
    expect((await detectNode('/test', files, new Set()))?.packageManager).toBe(
      detectPackageManager(files),
    );
    expect((await detectNode('/test', files, new Set()))?.packageManager).toBe('yarn');
  });

  it("takes the root's manager in a workspace package, like the scripts", async () => {
    const root = {
      path: '/mono',
      files: new Set(['package.json', 'pnpm-lock.yaml']),
      dirs: new Set<string>(),
    };
    const own = new Set(['package.json']);
    expect(await detectNode('/mono/packages/a', own, new Set(), { root })).toEqual({
      packageManager: 'pnpm',
      packageManagerSource: 'lockfile',
    });
    // The root's lockfile wins over the package's own, as in DetectedProject.packageManager.
    const yarn = new Set(['package.json', 'yarn.lock']);
    expect(await detectNode('/mono/packages/a', yarn, new Set(), { root })).toEqual({
      packageManager: 'pnpm',
      packageManagerSource: 'lockfile',
    });
    // A root without a lockfile leaves the package's own.
    const bare = { ...root, files: new Set(['package.json']) };
    expect(await detectNode('/mono/packages/a', yarn, new Set(), { root: bare })).toEqual({
      packageManager: 'yarn',
      packageManagerSource: 'lockfile',
    });
  });

  it("reads package.json's packageManager without a lockfile, the root's first in a workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), 'nestbox-node-pm-'));
    const pkg = join(root, 'packages', 'a');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(root, 'package.json'), '{"packageManager":"pnpm@9.12.0"}');
    await writeFile(join(pkg, 'package.json'), '{"name":"a"}');
    const files = new Set(['package.json']);
    expect(await detectNode(root, files, new Set())).toEqual({ packageManager: 'pnpm', packageManagerSource: 'packageManager' });
    const ctx = { root: { path: root, files, dirs: new Set<string>() } };
    expect(await detectNode(pkg, files, new Set(), ctx)).toEqual({ packageManager: 'pnpm', packageManagerSource: 'packageManager' });
    // A lockfile still decides when package.json can't be read; without one that is npm.
    await writeFile(join(root, 'package.json'), '{ not json');
    expect(await detectNode(root, new Set(['package.json', 'yarn.lock']), new Set())).toEqual({ packageManager: 'yarn', packageManagerSource: 'lockfile' });
    expect(await detectNode(root, files, new Set())).toEqual({ packageManager: 'npm', packageManagerSource: 'default' });
  });

  it('returns null without package.json', async () => {
    expect(await detectNode('/test', new Set(['README.md']), new Set())).toBeNull();
  });
});
