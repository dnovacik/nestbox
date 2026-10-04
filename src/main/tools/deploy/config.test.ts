import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configVarKeys,
  parseJsonc,
  readLocalConfig,
  tomlTableKeys,
  tomlTopLevel,
  wranglerEnvironments,
} from './config';

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'nestbox-deploy-config-'));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  return dir;
}

describe('tomlTopLevel', () => {
  it('reads a top-level string before the first table', () => {
    const text = [
      '# fly.toml',
      "app = 'shop-api'",
      'primary_region = "ams"',
      '',
      '[build]',
      '  app = "not-this"',
    ].join('\n');
    expect(tomlTopLevel(text, 'app')).toBe('shop-api');
    expect(tomlTopLevel(text, 'primary_region')).toBe('ams');
    expect(tomlTopLevel('[env]\nname = "x"', 'name')).toBeNull();
    expect(tomlTopLevel('name = 3', 'name')).toBeNull();
    expect(tomlTopLevel('name = "a" # comment', 'name')).toBe('a');
  });
});

describe('parseJsonc', () => {
  it('drops comments and trailing commas, keeping strings intact', () => {
    expect(
      parseJsonc('{\n // a comment\n "name": "w//x", /* block */ "main": "src/index.ts",\n}'),
    ).toEqual({ name: 'w//x', main: 'src/index.ts' });
    expect(parseJsonc('[1]')).toBeNull();
    expect(parseJsonc('{')).toBeNull();
  });
});

describe('readLocalConfig', () => {
  it('reads a linked Vercel project', async () => {
    const dir = tree({
      '.vercel/project.json': JSON.stringify({
        projectId: 'prj_1',
        orgId: 'team_1',
        projectName: 'shop',
      }),
    });
    expect(await readLocalConfig('vercel', dir)).toEqual({
      linked: true,
      name: 'shop',
      flavour: null,
    });
    const bare = tree({ 'vercel.json': '{}' });
    expect(await readLocalConfig('vercel', bare)).toEqual({
      linked: false,
      name: null,
      flavour: null,
    });
  });

  it('finds the Netlify site in the package or a parent up to the repository', async () => {
    const dir = tree({
      '.git/HEAD': 'ref: refs/heads/main',
      '.netlify/state.json': JSON.stringify({ siteId: 'abc-123' }),
      'apps/web/netlify.toml': '',
    });
    expect(await readLocalConfig('netlify', join(dir, 'apps', 'web'))).toEqual({
      linked: true,
      name: null,
      flavour: null,
    });
    const unlinked = tree({ '.git/HEAD': '', 'netlify.toml': '' });
    expect((await readLocalConfig('netlify', unlinked)).linked).toBe(false);
  });

  it('reads a Worker or a Pages project from wrangler.toml or wrangler.jsonc', async () => {
    expect(
      await readLocalConfig(
        'cloudflare',
        tree({ 'wrangler.toml': 'name = "api"\nmain = "src/index.ts"' }),
      ),
    ).toEqual({
      linked: true,
      name: 'api',
      flavour: 'workers',
    });
    expect(
      await readLocalConfig(
        'cloudflare',
        tree({
          'wrangler.jsonc': '{ // pages\n "name": "site", "pages_build_output_dir": "./dist", }',
        }),
      ),
    ).toEqual({ linked: true, name: 'site', flavour: 'pages' });
    expect(await readLocalConfig('cloudflare', tree({ 'wrangler.json': '{}' }))).toEqual({
      linked: false,
      name: null,
      flavour: 'workers',
    });
  });

  it('reads the Fly app', async () => {
    expect(await readLocalConfig('fly', tree({ 'fly.toml': "app = 'shop-api'\n" }))).toEqual({
      linked: true,
      name: 'shop-api',
      flavour: null,
    });
    expect((await readLocalConfig('fly', tree({ 'fly.toml': '[http_service]' }))).linked).toBe(
      false,
    );
  });

  it('ignores oversized files', async () => {
    const dir = tree({ 'fly.toml': `app = "x"\n${'#'.repeat(70 * 1024)}` });
    expect((await readLocalConfig('fly', dir)).linked).toBe(false);
  });
});

describe('config variables and environments', () => {
  it('reads the keys of a TOML table, stopping at the next one', () => {
    const text =
      'name = "api"\n[vars]\nAPI_URL = "x"\nFLAG="1" # on\n\n[env.staging.vars]\nAPI_URL = "y"\nEXTRA = "z"\n';
    expect(tomlTableKeys(text, 'vars')).toEqual(['API_URL', 'FLAG']);
    expect(tomlTableKeys(text, 'env.staging.vars')).toEqual(['API_URL', 'EXTRA']);
    expect(tomlTableKeys(text, 'missing')).toEqual([]);
  });

  it('lists named Workers environments from TOML or JSONC, valid names only', async () => {
    const toml = tree({
      'wrangler.toml':
        'name = "api"\n[env.staging]\nname="x"\n[env.staging.vars]\nA="1"\n[env.qa.vars]\n[env."bad name"]\n',
    });
    expect(await wranglerEnvironments(toml)).toEqual(['staging', 'qa']);
    const json = tree({
      'wrangler.jsonc': '{ "name": "api", "env": { "staging": {}, "-x": {} } }',
    });
    expect(await wranglerEnvironments(json)).toEqual(['staging']);
  });

  it('reads the variables a platform gets from config, per environment', async () => {
    const toml = tree({
      'wrangler.toml': 'name = "api"\n[vars]\nA = "1"\n[env.staging.vars]\nB = "2"\n',
    });
    expect(await configVarKeys('cloudflare', toml, 'production')).toEqual(['A']);
    expect(await configVarKeys('cloudflare', toml, 'staging')).toEqual(['B']);
    const json = tree({
      'wrangler.json':
        '{ "name": "s", "vars": { "C": "3" }, "env": { "preview": { "vars": { "D": "4" } } } }',
    });
    expect(await configVarKeys('cloudflare', json, 'production')).toEqual(['C']);
    expect(await configVarKeys('cloudflare', json, 'preview')).toEqual(['D']);
    const fly = tree({
      'fly.toml': "app = 'x'\n[env]\n  PORT = '8080'\n  NODE_ENV = 'production'\n[http_service]\n",
    });
    expect(await configVarKeys('fly', fly, 'app')).toEqual(['PORT', 'NODE_ENV']);
    expect(await configVarKeys('vercel', fly, 'production')).toEqual([]);
    const pages = tree({
      'wrangler.toml':
        'name = "s"\npages_build_output_dir = "dist"\n[vars]\nA = "1"\n[env.production.vars]\nP = "2"\n',
    });
    expect(await configVarKeys('cloudflare', pages, 'production')).toEqual(['P']);
    expect(await configVarKeys('cloudflare', pages, 'preview')).toEqual(['A']);
    const worker = tree({ 'wrangler.toml': 'name = "w"\n[vars]\nA = "1"\n[env.qa]\n' });
    expect(await configVarKeys('cloudflare', worker, 'qa')).toEqual([]);
  });
});
