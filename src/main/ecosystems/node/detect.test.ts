import { describe, expect, it } from 'vitest';
import { detectNode } from './detect';
import { detectPackageManager } from './package-manager';

describe('detectNode', () => {
  it('detects pnpm projects', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'pnpm' });
  });

  it('detects npm projects', async () => {
    const files = new Set(['package.json', 'package-lock.json']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'npm' });
  });

  it('detects yarn projects', async () => {
    const files = new Set(['package.json', 'yarn.lock']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'yarn' });
  });

  it('detects bun projects', async () => {
    const files = new Set(['package.json', 'bun.lockb']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'bun' });
  });

  it('defaults to npm when there is no lockfile', async () => {
    const files = new Set(['package.json']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'npm' });
  });

  it('prefers pnpm over the other lockfiles', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
    expect((await detectNode('/test', files, new Set()))?.packageManager).toBe('pnpm');
  });

  it('detects bun from the text lockfile', async () => {
    const files = new Set(['package.json', 'bun.lock']);
    expect(await detectNode('/test', files, new Set())).toEqual({ packageManager: 'bun' });
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
    });
    // The root's lockfile wins over the package's own, as in DetectedProject.packageManager.
    const yarn = new Set(['package.json', 'yarn.lock']);
    expect(await detectNode('/mono/packages/a', yarn, new Set(), { root })).toEqual({
      packageManager: 'pnpm',
    });
    // A root without a lockfile leaves the package's own.
    const bare = { ...root, files: new Set(['package.json']) };
    expect(await detectNode('/mono/packages/a', yarn, new Set(), { root: bare })).toEqual({
      packageManager: 'yarn',
    });
  });

  it('returns null without package.json', async () => {
    expect(await detectNode('/test', new Set(['README.md']), new Set())).toBeNull();
  });
});
