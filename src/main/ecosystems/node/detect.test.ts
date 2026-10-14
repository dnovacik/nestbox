import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { detectNode } from './detect';
import { detectPackageManager } from './package-manager';

describe('detectNode', () => {
  it('detects pnpm projects', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml']);
    expect(await detectNode('/test', files, new Set())).toEqual({
      name: null,
      scripts: {},
      packageManager: 'pnpm',
      packageManagerSource: 'lockfile',
      lockfiles: expect.any(Array),
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
  });

  it('detects npm projects', async () => {
    const files = new Set(['package.json', 'package-lock.json']);
    expect(await detectNode('/test', files, new Set())).toEqual({
      name: null,
      scripts: {},
      packageManager: 'npm',
      packageManagerSource: 'lockfile',
      lockfiles: expect.any(Array),
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
  });

  it('detects yarn projects', async () => {
    const files = new Set(['package.json', 'yarn.lock']);
    expect(await detectNode('/test', files, new Set())).toEqual({
      name: null,
      scripts: {},
      packageManager: 'yarn',
      packageManagerSource: 'lockfile',
      lockfiles: expect.any(Array),
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
  });

  it('detects bun projects', async () => {
    const files = new Set(['package.json', 'bun.lockb']);
    expect(await detectNode('/test', files, new Set())).toEqual({
      name: null,
      scripts: {},
      packageManager: 'bun',
      packageManagerSource: 'lockfile',
      lockfiles: expect.any(Array),
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
  });

  it('defaults to npm when there is no lockfile', async () => {
    const files = new Set(['package.json']);
    expect(await detectNode('/test', files, new Set())).toEqual({
      name: null,
      scripts: {},
      packageManager: 'npm',
      packageManagerSource: 'default',
      lockfiles: [],
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
  });

  it('prefers pnpm over the other lockfiles', async () => {
    const files = new Set(['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);
    expect((await detectNode('/test', files, new Set()))?.packageManager).toBe('pnpm');
  });

  it('detects bun from the text lockfile', async () => {
    const files = new Set(['package.json', 'bun.lock']);
    expect(await detectNode('/test', files, new Set())).toEqual({
      name: null,
      scripts: {},
      packageManager: 'bun',
      packageManagerSource: 'lockfile',
      lockfiles: expect.any(Array),
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
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
      name: null,
      scripts: {},
      packageManager: 'pnpm',
      packageManagerSource: 'lockfile',
      lockfiles: expect.any(Array),
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
    // The root's lockfile wins over the package's own, as in DetectedProject.packageManager.
    const yarn = new Set(['package.json', 'yarn.lock']);
    expect(await detectNode('/mono/packages/a', yarn, new Set(), { root })).toEqual({
      name: null,
      scripts: {},
      packageManager: 'pnpm',
      packageManagerSource: 'lockfile',
      lockfiles: expect.any(Array),
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
    // A root without a lockfile leaves the package's own.
    const bare = { ...root, files: new Set(['package.json']) };
    expect(await detectNode('/mono/packages/a', yarn, new Set(), { root: bare })).toEqual({
      name: null,
      scripts: {},
      packageManager: 'yarn',
      packageManagerSource: 'lockfile',
      lockfiles: expect.any(Array),
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
  });

  it("reads package.json's packageManager without a lockfile, the root's first in a workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), 'nestbox-node-pm-'));
    const pkg = join(root, 'packages', 'a');
    await mkdir(pkg, { recursive: true });
    await writeFile(join(root, 'package.json'), '{"packageManager":"pnpm@9.12.0"}');
    await writeFile(join(pkg, 'package.json'), '{"name":"a"}');
    const files = new Set(['package.json']);
    expect(await detectNode(root, files, new Set())).toEqual({
      name: null,
      scripts: {},
      packageManager: 'pnpm',
      packageManagerSource: 'packageManager',
      lockfiles: [],
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
    const ctx = { root: { path: root, files, dirs: new Set<string>() } };
    expect(await detectNode(pkg, files, new Set(), ctx)).toEqual({
      name: 'a',
      scripts: {},
      packageManager: 'pnpm',
      packageManagerSource: 'packageManager',
      lockfiles: [],
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
    // A lockfile still decides when package.json can't be read; without one that is npm.
    await writeFile(join(root, 'package.json'), '{ not json');
    expect(await detectNode(root, new Set(['package.json', 'yarn.lock']), new Set())).toEqual({
      name: null,
      scripts: {},
      packageManager: 'yarn',
      packageManagerSource: 'lockfile',
      lockfiles: expect.any(Array),
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
    expect(await detectNode(root, files, new Set())).toEqual({
      name: null,
      scripts: {},
      packageManager: 'npm',
      packageManagerSource: 'default',
      lockfiles: [],
      framework: null,
      ports: [],
      hasDependencies: false,
      monorepo: null,
    });
  });

  it("records the lockfiles of the folder that decided: the root's in a workspace package", async () => {
    const files = new Set(['package.json', 'yarn.lock', 'package-lock.json']);
    expect((await detectNode('/test', files, new Set()))?.lockfiles).toEqual([
      'yarn.lock',
      'package-lock.json',
    ]);
    const root = {
      path: '/mono',
      files: new Set(['package.json', 'pnpm-lock.yaml']),
      dirs: new Set<string>(),
    };
    expect((await detectNode('/mono/a', files, new Set(), { root }))?.lockfiles).toEqual([
      'pnpm-lock.yaml',
    ]);
  });

  it("names the framework from package.json's dependencies, whatever decided the manager", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nestbox-node-fw-'));
    await writeFile(
      join(dir, 'package.json'),
      '{"dependencies":{"next":"^15.0.3"},"devDependencies":{"vite":"^6"}}',
    );
    const locked = new Set(['package.json', 'pnpm-lock.yaml']);
    expect((await detectNode(dir, locked, new Set()))?.framework).toEqual({
      id: 'next',
      major: 15,
    });
    expect((await detectNode(dir, new Set(['package.json']), new Set()))?.framework).toEqual({
      id: 'next',
      major: 15,
    });
  });

  it('finds the dev server ports from the scripts and the framework', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nestbox-node-ports-'));
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        scripts: { dev: 'vite --port 3001', build: 'vite build' },
        devDependencies: { vite: '^6' },
      }),
    );
    expect((await detectNode(dir, new Set(['package.json']), new Set()))?.ports).toEqual([
      3001, 5173,
    ]);
  });

  it('knows whether package.json lists anything to install', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nestbox-node-deps-'));
    const files = new Set(['package.json']);
    await writeFile(join(dir, 'package.json'), '{"devDependencies":{"vitest":"^3"}}');
    expect((await detectNode(dir, files, new Set()))?.hasDependencies).toBe(true);
    await writeFile(join(dir, 'package.json'), '{"dependencies":{},"scripts":{"x":"y"}}');
    expect((await detectNode(dir, files, new Set()))?.hasDependencies).toBe(false);
  });

  it("reads package.json's name and string scripts", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nestbox-node-name-'));
    await writeFile(
      join(dir, 'package.json'),
      '﻿' + JSON.stringify({ name: 'shop', scripts: { dev: 'vite', build: 'vite build', bad: 5 } }),
    );
    const info = await detectNode(dir, new Set(['package.json']), new Set());
    expect(info).toMatchObject({ name: 'shop', scripts: { dev: 'vite', build: 'vite build' } });
    await writeFile(join(dir, 'package.json'), '{"name":"  ","scripts":[]}');
    expect(await detectNode(dir, new Set(['package.json']), new Set())).toMatchObject({
      name: null,
      scripts: {},
    });
  });

  it('warns with the file name only when package.json is not a JSON object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nestbox-node-bad-'));
    const onWarning = vi.fn();
    await writeFile(join(dir, 'package.json'), '{"name": "SECRET_TOKEN_123", oops');
    expect(
      await detectNode(dir, new Set(['package.json']), new Set(), { root: null, onWarning }),
    ).toMatchObject({
      name: null,
      scripts: {},
    });
    expect(onWarning).toHaveBeenCalledWith('package.json', 'invalid-json');
    await writeFile(join(dir, 'package.json'), '[1,2]');
    await detectNode(dir, new Set(['package.json']), new Set(), { root: null, onWarning });
    expect(onWarning).toHaveBeenCalledWith('package.json', 'not-an-object');
    expect(JSON.stringify(onWarning.mock.calls)).not.toContain('SECRET_TOKEN_123');
  });

  it('returns null without package.json', async () => {
    expect(await detectNode('/test', new Set(['README.md']), new Set())).toBeNull();
  });
});
