import { describe, expect, it } from 'vitest';
import { detectPackageManager } from './package-manager';

describe('detectPackageManager', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
  ])('%s → %s', (file, pm) => {
    expect(detectPackageManager(new Set([file]))).toBe(pm);
  });

  it('prefers pnpm, then yarn, then npm when several lockfiles exist', () => {
    expect(detectPackageManager(new Set(['package-lock.json', 'pnpm-lock.yaml']))).toBe('pnpm');
    expect(detectPackageManager(new Set(['package-lock.json', 'yarn.lock']))).toBe('yarn');
  });

  it('returns null without a lockfile', () => {
    expect(detectPackageManager(new Set(['package.json']))).toBeNull();
  });
});
