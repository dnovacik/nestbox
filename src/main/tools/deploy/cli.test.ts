import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { cliCommand, INSTALL, loginCommand, resolveCli } from './cli';

function withPackage(pkg: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'nestbox-deploy-cli-'));
  const dir = join(root, 'apps', 'web');
  mkdirSync(dir, { recursive: true });
  if (pkg) {
    mkdirSync(join(root, 'node_modules', pkg), { recursive: true });
    writeFileSync(join(root, 'node_modules', pkg, 'package.json'), '{}');
  }
  return dir;
}

describe('resolveCli', () => {
  it("prefers the package's own CLI, found the way Node finds packages, through the package manager", async () => {
    const exists = vi.fn(async () => true);
    const cli = await resolveCli('cloudflare', withPackage('wrangler'), 'pnpm', exists);
    expect(cli).toEqual({ kind: 'local', command: 'pnpm', prefix: ['exec', 'wrangler'] });
    expect(exists).not.toHaveBeenCalled();
    expect(cli && cliCommand(cli, ['deploy'])).toEqual({
      command: 'pnpm',
      args: ['exec', 'wrangler', 'deploy'],
    });
    expect(await resolveCli('netlify', withPackage('netlify-cli'), 'npm', exists)).toMatchObject({
      command: 'npx',
      prefix: ['--no-install', 'netlify'],
    });
    expect(await resolveCli('vercel', withPackage('vercel'), 'yarn', exists)).toMatchObject({
      command: 'yarn',
      prefix: ['vercel'],
    });
    expect(await resolveCli('vercel', withPackage('vercel'), 'bun', exists)).toMatchObject({
      command: 'bunx',
      prefix: ['--no-install', 'vercel'],
    });
  });

  it('falls back to a global CLI, and to fly when flyctl is missing', async () => {
    const dir = withPackage(null);
    expect(await resolveCli('vercel', dir, 'npm', async () => true)).toEqual({
      kind: 'global',
      command: 'vercel',
      prefix: [],
    });
    const onlyFly = vi.fn(async (c: string) => c === 'fly');
    expect(await resolveCli('fly', dir, 'npm', onlyFly)).toEqual({
      kind: 'global',
      command: 'fly',
      prefix: [],
    });
    expect(onlyFly.mock.calls.map(([c]) => c)).toEqual(['flyctl', 'fly']);
  });

  it('is null when nothing is installed; an unknown lookup counts as installed', async () => {
    const dir = withPackage(null);
    expect(await resolveCli('netlify', dir, 'npm', async () => false)).toBeNull();
    expect(await resolveCli('netlify', dir, null, async () => null)).toMatchObject({
      kind: 'global',
    });
  });

  it('builds the login command for a terminal and has an install hint for every platform', () => {
    expect(loginCommand('fly', { kind: 'global', command: 'flyctl', prefix: [] })).toBe(
      'flyctl auth login',
    );
    expect(
      loginCommand('cloudflare', { kind: 'local', command: 'pnpm', prefix: ['exec', 'wrangler'] }),
    ).toBe('pnpm exec wrangler login');
    expect(Object.keys(INSTALL).sort()).toEqual(['cloudflare', 'fly', 'netlify', 'vercel']);
  });
});
