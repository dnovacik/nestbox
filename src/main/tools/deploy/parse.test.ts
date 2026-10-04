import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  deployUrl,
  parseFlyReleases,
  parseNetlifyStatus,
  parsePagesList,
  parseVercelList,
  parseWorkersList,
  productionBranch,
} from './parse';

const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('parseVercelList', () => {
  it('keeps state, environment, branch, time and https URLs, and the team for the dashboard', () => {
    const parsed = parseVercelList(fixture('vercel-list.json'));
    expect(parsed?.context).toBe('acme');
    expect(parsed?.project).toBe('shop');
    expect(parsed?.deployments).toEqual([
      {
        id: 'dpl_8xKq2mNw',
        state: 'building',
        environment: 'preview',
        branch: 'feature/cart',
        label: null,
        createdAt: 1759600800000,
        url: 'https://shop-git-feature-acme.vercel.app',
        logsUrl: 'https://vercel.com/acme/shop/8xKq2mNw',
      },
      expect.objectContaining({ state: 'ready', environment: 'production', branch: 'main' }),
      expect.objectContaining({ state: 'error', branch: null }),
    ]);
  });

  it('drops commit messages and authors', () => {
    expect(JSON.stringify(parseVercelList(fixture('vercel-list.json')))).not.toMatch(/Add the cart|Dana|dana/);
  });

  it('reads an empty list and refuses anything else', () => {
    expect(parseVercelList('{"deployments":[],"contextName":"acme"}')?.deployments).toEqual([]);
    expect(parseVercelList('Error: not linked')).toBeNull();
    expect(parseVercelList('{"items":[]}')).toBeNull();
  });
});

describe('parseWorkersList', () => {
  it('lists the newest deployment first with its version split, and no author', () => {
    const list = parseWorkersList(fixture('workers-deployments.json'), 'https://dash.example/api');
    expect(list?.map((d) => [d.id.slice(-1), d.label, d.environment, d.state])).toEqual([
      ['2', '9c8d7e6f 90% · 7f3e9a21 10%', 'production', 'ready'],
      ['1', '7f3e9a21 100%', 'production', 'ready'],
    ]);
    expect(list?.[0]?.createdAt).toBe(Date.parse('2025-10-04T09:30:00Z'));
    expect(list?.[0]?.logsUrl).toBe('https://dash.example/api');
    expect(JSON.stringify(list)).not.toMatch(/dana|secret plans/);
    expect(parseWorkersList('{}', null)).toBeNull();
  });
});

describe('parsePagesList', () => {
  it('maps the status words, keeps the commit as the label and drops non-https links', () => {
    const list = parsePagesList(fixture('pages-deployments.json'));
    expect(list?.map((d) => [d.state, d.environment, d.branch, d.label])).toEqual([
      ['building', 'preview', 'nestbox-preview', '1a2b3c4'],
      ['ready', 'production', 'main', '9f8e7d6'],
      ['error', 'preview', 'feature/x', '0a1b2c3'],
    ]);
    expect(list?.[1]?.url).toBe('https://6f2a3b4c.site.pages.dev');
    expect(list?.[2]?.logsUrl).toBeNull();
    expect(list && productionBranch(list)).toBe('main');
    expect(productionBranch([])).toBeNull();
    expect(parsePagesList('nope')).toBeNull();
  });

  it('refuses a production branch that is not a plain token', () => {
    const list = parsePagesList(JSON.stringify([{ Id: '1', Environment: 'Production', Branch: '-rf', Status: 'x' }]));
    expect(list && productionBranch(list)).toBeNull();
  });
});

describe('parseFlyReleases', () => {
  it('lists releases with their version, state and time, and no user', () => {
    const list = parseFlyReleases(fixture('fly-releases.json'), 'https://fly.io/apps/shop-api/monitoring');
    expect(list?.map((d) => [d.label, d.state])).toEqual([
      ['v14', 'building'],
      ['v13', 'ready'],
      ['v12', 'error'],
    ]);
    expect(list?.[1]?.createdAt).toBe(Date.parse('2025-10-03T11:00:00Z'));
    expect(JSON.stringify(list)).not.toMatch(/dana|registry\.fly\.io/);
    expect(parseFlyReleases('null', null)).toBeNull();
  });
});

describe('parseNetlifyStatus', () => {
  it('keeps the site name and URLs, never the account', () => {
    expect(parseNetlifyStatus(fixture('netlify-status.json'))).toEqual({
      state: 'site',
      name: 'shop-acme',
      url: 'https://shop-acme.netlify.app',
      adminUrl: 'https://app.netlify.com/projects/shop-acme',
    });
  });

  it('reports logged out and not linked from its error codes', () => {
    expect(parseNetlifyStatus(fixture('netlify-status-logged-out.json'))).toEqual({ state: 'logged-out' });
    expect(parseNetlifyStatus('{"loggedIn":true,"linked":false,"siteData":null,"error":{"code":"NOT_LINKED"}}')).toEqual(
      { state: 'not-linked' },
    );
    expect(parseNetlifyStatus('boom')).toBeNull();
  });
});

describe('classifyFailure', () => {
  it("recognises each CLI's logged-out and not-linked wording", () => {
    expect(classifyFailure('vercel', 'Error: No existing credentials found. Please run `vercel login`')).toBe('logged-out');
    expect(classifyFailure('vercel', "Error: Your codebase isn't linked to a project on Vercel. Run `vercel link`")).toBe(
      'not-linked',
    );
    expect(
      classifyFailure('cloudflare', "In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN"),
    ).toBe('logged-out');
    expect(classifyFailure('cloudflare', 'You are not authenticated. Please run `wrangler login`.')).toBe('logged-out');
    expect(classifyFailure('fly', 'Error: no access token available. Please login with `flyctl auth login`')).toBe(
      'logged-out',
    );
    expect(classifyFailure('netlify', 'Not logged in. Please log in to see project status.')).toBe('logged-out');
    expect(classifyFailure('fly', 'Error: failed to fetch an image or build from source')).toBe('failed');
  });
});

describe('deployUrl', () => {
  it("takes the last platform URL from the output, ignoring other hosts and lookalikes", () => {
    const out = [
      'Inspect: https://vercel.com/acme/shop/8xKq2mNw [2s]',
      'Preview: https://shop-git-x-acme.vercel.app [12s]',
      'see https://evil.example/?u=a.vercel.app',
    ].join('\n');
    expect(deployUrl('vercel', out)).toBe('https://shop-git-x-acme.vercel.app');
    expect(deployUrl('netlify', '"deploy_url": "https://66f-shop.netlify.app",')).toBe('https://66f-shop.netlify.app');
    expect(deployUrl('cloudflare', 'Version Preview URL: https://abc-api.acme.workers.dev')).toBe(
      'https://abc-api.acme.workers.dev',
    );
    expect(deployUrl('cloudflare', '✨ Deployment complete! https://1a2b.site.pages.dev')).toBe('https://1a2b.site.pages.dev');
    expect(deployUrl('fly', 'Visit your newly deployed app at https://shop-api.fly.dev/')).toBe('https://shop-api.fly.dev/');
    expect(deployUrl('vercel', 'nothing here')).toBeNull();
  });
});
