import { describe, expect, it } from 'vitest';
import {
  choosePackageManager,
  detectPackageManager,
  lockfilesIn,
  lockfileWarning,
} from './package-manager';

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

describe('choosePackageManager', () => {
  const lock = (file: string) => new Set(['package.json', file]);
  const bare = new Set(['package.json']);

  it("uses package.json's packageManager when there is no lockfile", () => {
    expect(choosePackageManager({ files: bare, field: 'pnpm@9.12.0' })).toEqual({
      manager: 'pnpm',
      source: 'packageManager',
    });
    expect(choosePackageManager({ files: bare, field: 'yarn@4.5.0+sha512.abc' })).toEqual({
      manager: 'yarn',
      source: 'packageManager',
    });
  });

  it('keeps the lockfile over the field: it is what was installed', () => {
    expect(choosePackageManager({ files: lock('yarn.lock'), field: 'pnpm@9.12.0' })).toEqual({
      manager: 'yarn',
      source: 'lockfile',
    });
  });

  it.each([['pnpm'], ['pnpm@latest'], ['deno@2.0.0'], [42], [undefined]])(
    'falls back to npm for %s',
    (field) => {
      expect(choosePackageManager({ files: bare, field })).toEqual({
        manager: 'npm',
        source: 'default',
      });
    },
  );

  it("follows the root in a workspace package: its lockfile, then its field, then the package's own", () => {
    const root = { files: bare, field: 'pnpm@9.12.0' };
    expect(choosePackageManager({ files: bare, field: 'yarn@4.5.0', root })).toEqual({
      manager: 'pnpm',
      source: 'packageManager',
    });
    expect(choosePackageManager({ files: lock('yarn.lock'), root })).toEqual({
      manager: 'yarn',
      source: 'lockfile',
    });
    expect(
      choosePackageManager({
        files: bare,
        root: { files: lock('bun.lock'), field: 'pnpm@9.12.0' },
      }),
    ).toEqual({ manager: 'bun', source: 'lockfile' });
    expect(
      choosePackageManager({ files: bare, field: 'yarn@4.5.0', root: { files: bare } }),
    ).toEqual({ manager: 'yarn', source: 'packageManager' });
  });
});

describe('lockfiles', () => {
  it('lists the lockfiles in priority order', () => {
    expect(lockfilesIn(new Set(['package.json', 'package-lock.json', 'yarn.lock']))).toEqual([
      'yarn.lock',
      'package-lock.json',
    ]);
    expect(lockfilesIn(new Set(['package.json']))).toEqual([]);
  });

  it('warns only when they name more than one manager', () => {
    expect(lockfileWarning(['yarn.lock', 'package-lock.json'], 'yarn')).toBe(
      'Two lockfiles: yarn.lock and package-lock.json; NestBox uses yarn',
    );
    expect(lockfileWarning(['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'], 'pnpm')).toBe(
      'Three lockfiles: pnpm-lock.yaml, yarn.lock and package-lock.json; NestBox uses pnpm',
    );
    // bun.lockb and bun.lock are one manager (Bun 1.2 moved to the text lockfile).
    expect(lockfileWarning(['bun.lockb', 'bun.lock'], 'bun')).toBeNull();
    expect(lockfileWarning(['yarn.lock'], 'yarn')).toBeNull();
    expect(lockfileWarning([], 'npm')).toBeNull();
  });
});
