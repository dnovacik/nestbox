import { symlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectProject } from './detect-project';
import { makeTree, removeTree } from './test-fixtures';
import { nodeInfo } from '../ecosystems/node/fixtures';
import { nodeModule } from '../ecosystems/node';
import { nodeOf } from '@shared/ecosystems/node';

let dir = '';
afterEach(async () => removeTree(dir));

describe('detectProject', () => {
  it('marks a missing folder as missing', async () => {
    const d = await detectProject({ id: 'p1', path: join(__dirname, 'does-not-exist'), name: 'gone' });
    expect(d).toMatchObject({ id: 'p1', rootId: 'p1', missing: true, name: 'gone', workspaces: [], git: null });
  });

  it('reads name and string scripts from package.json', async () => {
    dir = await makeTree({
      'package.json': JSON.stringify({ name: 'shop', scripts: { dev: 'vite', build: 'vite build', bad: 5 } }),
    });
    const d = await detectProject({ id: 'p1', path: dir });
    expect(d.name).toBe('shop');
    expect(nodeOf(d)).toMatchObject({ name: 'shop', scripts: { dev: 'vite', build: 'vite build' } });
    expect(d.path).toBe(dir);
    expect(d.relPath).toBe('');
  });

  it('prefers the stored name, then package.json name, then folder name', async () => {
    dir = await makeTree({ 'package.json': JSON.stringify({ name: 'shop' }) });
    expect((await detectProject({ id: 'p', path: dir, name: 'My Shop' })).name).toBe('My Shop');
    const bare = await makeTree({ 'README.md': 'x' });
    try {
      expect((await detectProject({ id: 'p', path: bare })).name).toBe(bare.split(/[\\/]/).pop());
    } finally {
      await removeTree(bare);
    }
  });

  it('parses package.json with a UTF-8 BOM', async () => {
    dir = await makeTree({ 'package.json': '﻿{"name":"bom"}' });
    expect(nodeOf(await detectProject({ id: 'p', path: dir }))?.name).toBe('bom');
  });

  it('survives invalid package.json and warns with the file name only', async () => {
    dir = await makeTree({ 'package.json': '{"name": "SECRET_TOKEN_123", oops' });
    const onWarning = vi.fn();
    const d = await detectProject({ id: 'p', path: dir }, { onWarning });
    expect(nodeOf(d)).toMatchObject({ name: null, scripts: {} });
    expect(d.name).toBe(basename(dir));
    expect(onWarning).toHaveBeenCalledWith('package.json', 'invalid-json');
    expect(JSON.stringify(onWarning.mock.calls)).not.toContain('SECRET_TOKEN_123');
  });

  it('warns when package.json is not an object', async () => {
    dir = await makeTree({ 'package.json': '[1,2]' });
    const onWarning = vi.fn();
    expect(nodeOf(await detectProject({ id: 'p', path: dir }, { onWarning }))?.scripts).toEqual({});
    expect(onWarning).toHaveBeenCalledWith('package.json', 'not-an-object');
  });

  it("names a workspace package's unreadable package.json by its path", async () => {
    dir = await makeTree({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/web/package.json': '{ oops',
    });
    const onWarning = vi.fn();
    await detectProject({ id: 'p', path: dir }, { onWarning });
    expect(onWarning).toHaveBeenCalledWith('packages/web/package.json', 'invalid-json');
  });

  it('lists .env* file names only, sorted, ignoring directories', async () => {
    dir = await makeTree({
      '.env': 'DATABASE_URL=postgres://user:SECRET@host/db',
      '.env.example': 'DATABASE_URL=',
      '.env.local': 'X=1',
      '.env.production.local': 'X=2',
      '.envrc': 'use nix',
      '.envrc.d': null,
      '.env.d': null,
      'env.txt': 'x',
    });
    const d = await detectProject({ id: 'p', path: dir });
    expect(d.envFiles).toEqual(['.env', '.env.example', '.env.local', '.env.production.local']);
    expect(d.envSymlinks).toEqual([]);
    expect(JSON.stringify(d)).not.toContain('SECRET');
  });

  it('lists symlinked env files and marks them', async (ctx) => {
    dir = await makeTree({ 'shared.env': 'A=1', '.env': 'B=2' });
    try {
      await symlink(join(dir, 'shared.env'), join(dir, '.env.shared'), 'file');
    } catch {
      ctx.skip(); // creating symlinks needs a privilege on some Windows machines
    }
    const d = await detectProject({ id: 'p', path: dir });
    expect(d.envFiles).toEqual(['.env', '.env.shared']);
    expect(d.envSymlinks).toEqual(['.env.shared']);
  });

  it('detects package manager, prisma, compose, build output and Claude files', async () => {
    dir = await makeTree({
      'package.json': '{}',
      'pnpm-lock.yaml': '',
      'prisma/schema.prisma': 'datasource db {}',
      'compose.yaml': 'services: {}',
      dist: null,
      'CLAUDE.md': '# hi',
      '.claude': null,
      '.mcp.json': '{}',
    });
    const d = await detectProject({ id: 'p', path: dir });
    expect(nodeOf(d)?.packageManager).toBe('pnpm');
    expect(d.prismaSchema).toBe('prisma/schema.prisma');
    expect(d.dockerCompose).toBe('compose.yaml');
    expect(d.buildOutput).toBe('dist');
    expect(d.claude).toEqual({ claudeMd: true, claudeLocalMd: false, claudeDir: true, mcpJson: true });
  });

  it('detects a multi-file prisma schema folder and docker-compose.yml', async () => {
    dir = await makeTree({ 'prisma/schema': null, 'docker-compose.yml': '', build: null });
    const d = await detectProject({ id: 'p', path: dir });
    expect(d.prismaSchema).toBe('prisma/schema');
    expect(d.dockerCompose).toBe('docker-compose.yml');
    expect(d.buildOutput).toBe('build');
  });

  it('detects deployment platforms from their config files', async () => {
    dir = await makeTree({
      'vercel.json': '{}',
      '.netlify/state.json': '{}',
      'wrangler.jsonc': '{}',
      'fly.toml': '',
    });
    expect((await detectProject({ id: 'p', path: dir })).deploy).toEqual(['vercel', 'netlify', 'cloudflare', 'fly']);
    await removeTree(dir);
    dir = await makeTree({ '.vercel/project.json': '{}', 'wrangler.toml': '', 'netlify.toml.bak': '' });
    expect((await detectProject({ id: 'p', path: dir })).deploy).toEqual(['vercel', 'cloudflare']);
    await removeTree(dir);
    dir = await makeTree({ 'package.json': '{}' });
    expect((await detectProject({ id: 'p', path: dir })).deploy).toEqual([]);
  });

  it('includes git info', async () => {
    dir = await makeTree({ '.git/HEAD': 'ref: refs/heads/main\n' });
    expect((await detectProject({ id: 'p', path: dir })).git).toEqual({ branch: 'main', head: null });
  });
});

describe('detectProject workspaces', () => {
  it('nests workspace packages with derived ids and the root package manager', async () => {
    dir = await makeTree({
      'package.json': JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }),
      'pnpm-lock.yaml': '',
      'packages/api/package.json': JSON.stringify({ name: '@mono/api', scripts: { dev: 'tsx watch' } }),
      'packages/api/.env.example': 'PORT=',
      'packages/web/package.json': JSON.stringify({ name: '@mono/web' }),
    });
    const d = await detectProject({ id: 'root', path: dir });
    expect(d.workspaces.map((w) => [w.id, w.relPath, w.name, nodeOf(w)?.packageManager])).toEqual([
      ['root::packages/api', 'packages/api', '@mono/api', 'pnpm'],
      ['root::packages/web', 'packages/web', '@mono/web', 'pnpm'],
    ]);
    expect(d.workspaces[0]?.envFiles).toEqual(['.env.example']);
    expect(d.workspaces[0]?.workspaces).toEqual([]);
    expect(d.workspaces[0]?.rootId).toBe('root');
    // The Node module's tasks and summary use the same manager as the scripts.
    expect(d.workspaces.map((w) => w.ecosystems.find((e) => e.id === 'node')?.info)).toEqual([
      nodeInfo({
        name: '@mono/api',
        scripts: { dev: 'tsx watch' },
        packageManager: 'pnpm',
        lockfiles: ['pnpm-lock.yaml'],
      }),
      nodeInfo({ name: '@mono/web', packageManager: 'pnpm', lockfiles: ['pnpm-lock.yaml'] }),
    ]);
  });

  it("gives a monorepo root workspace-wide tasks for the scripts its packages share", async () => {
    dir = await makeTree({
      'package.json': JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }),
      'pnpm-lock.yaml': '',
      'packages/api/package.json': JSON.stringify({ name: '@mono/api', scripts: { build: 'tsc' } }),
      'packages/web/package.json': JSON.stringify({ name: '@mono/web', scripts: { build: 'vite build' } }),
    });
    const d = await detectProject({ id: 'root', path: dir });
    const node = d.ecosystems.find((e) => e.id === 'node');
    const tasks = nodeModule.tasks(nodeModule.infoSchema.parse(node?.info));
    expect(tasks.find((t) => t.name === 'all:build')?.argv).toEqual(['pnpm', '-r', 'run', 'build']);
    // The packages themselves get none.
    expect(d.workspaces.map((w) => (w.ecosystems[0]?.info as { monorepo: unknown }).monorepo)).toEqual([null, null]);
  });

  // For scripts and the Node module alike.
  it("uses the root's packageManager field when nothing has a lockfile", async () => {
    dir = await makeTree({
      'package.json': JSON.stringify({ name: 'mono', workspaces: ['packages/*'], packageManager: 'yarn@4.5.0' }),
      'packages/api/package.json': JSON.stringify({ name: '@mono/api' }),
    });
    const d = await detectProject({ id: 'root', path: dir });
    expect(nodeOf(d)?.packageManager).toBe('yarn');
    expect(d.workspaces.map((w) => [nodeOf(w)?.packageManager, w.ecosystems.find((e) => e.id === 'node')?.info])).toEqual([
      [
        'yarn',
        nodeInfo({
          name: '@mono/api',
          packageManager: 'yarn',
          packageManagerSource: 'packageManager',
        }),
      ],
    ]);
    // Without lockfile or field, the module says npm, by default.
    await removeTree(dir);
    dir = await makeTree({ 'package.json': '{}' });
    const plain = await detectProject({ id: 'p', path: dir });
    expect(plain.ecosystems.find((e) => e.id === 'node')?.info).toEqual(
      nodeInfo({ packageManagerSource: 'default' }),
    );
  });

  it('labels warnings from workspace packages with their relative path', async () => {
    dir = await makeTree({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/bad/package.json': '{oops',
    });
    const onWarning = vi.fn();
    await detectProject({ id: 'root', path: dir }, { onWarning });
    expect(onWarning).toHaveBeenCalledWith('packages/bad/package.json', 'invalid-json');
  });
});