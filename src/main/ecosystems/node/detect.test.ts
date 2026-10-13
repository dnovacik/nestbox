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

  it('returns null without package.json', async () => {
    expect(await detectNode('/test', new Set(['README.md']), new Set())).toBeNull();
  });
});
