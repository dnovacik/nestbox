import { describe, expect, it } from 'vitest';
import type { PortRow } from '@shared/ports';
import type { ProcessSummary } from '@shared/processes';
import { buildRoutes, resolveHost, type RouterInput } from './router';

const proc = (projectId: string, script: string, startedAt = 1): ProcessSummary =>
  ({ projectId, script, state: 'running', startedAt }) as ProcessSummary;
const port = (
  n: number,
  projectId: string,
  script: string,
  addresses = ['127.0.0.1'],
): PortRow => ({
  port: n,
  pid: 100 + n,
  addresses,
  processName: 'node',
  command: null,
  owner: { projectId, script },
});

const base: RouterInput = {
  projects: [
    {
      id: 'r1',
      name: 'Shop',
      workspaces: [{ id: 'r1::packages/api', name: '@shop/api', relPath: 'packages/api' }],
    },
  ],
  overrides: {},
  rewriteHost: {},
  mainScripts: new Map(),
  processes: [],
  ports: [],
  detectedPorts: new Map(),
  ownPorts: [80, 443],
};

describe('buildRoutes', () => {
  it('prefers the main command, then the earliest running script, then the detected port', () => {
    const table = buildRoutes({
      ...base,
      mainScripts: new Map([['r1', 'web']]),
      processes: [
        proc('r1', 'storybook', 1),
        proc('r1', 'web', 2),
        proc('r1::packages/api', 'dev', 3),
      ],
      ports: [
        port(6006, 'r1', 'storybook'),
        port(5173, 'r1', 'web'),
        port(3000, 'r1::packages/api', 'dev'),
      ],
    });
    expect(table.routes).toEqual([
      {
        name: 'shop.localhost',
        projectId: 'r1',
        script: 'web',
        port: 5173,
        source: 'main',
        rewriteHost: false,
      },
      {
        name: 'storybook.shop.localhost',
        projectId: 'r1',
        script: 'storybook',
        port: 6006,
        source: 'script',
        rewriteHost: false,
      },
      {
        name: 'api.shop.localhost',
        projectId: 'r1::packages/api',
        script: 'dev',
        port: 3000,
        source: 'script',
        rewriteHost: false,
      },
    ]);
  });

  it('falls back to the detected port, then none', () => {
    const table = buildRoutes({ ...base, detectedPorts: new Map([['r1', 5173]]) });
    expect(table.routes.map((r) => [r.name, r.port, r.source])).toEqual([
      ['shop.localhost', 5173, 'detected'],
      ['api.shop.localhost', null, 'none'],
    ]);
  });

  it('ignores ports that point back at the proxy, or are 0', () => {
    const table = buildRoutes({
      ...base,
      processes: [proc('r1', 'dev')],
      ports: [port(443, 'r1', 'dev'), port(0, 'r1', 'dev')],
    });
    expect(table.routes[0]).toMatchObject({ name: 'shop.localhost', port: null, source: 'none' });
  });

  it('marks IPv6-only targets and the projects whose Host is rewritten', () => {
    const table = buildRoutes({
      ...base,
      rewriteHost: { r1: true },
      processes: [proc('r1', 'dev')],
      ports: [port(3000, 'r1', 'dev', ['::1'])],
    });
    expect(table.byName.get('shop.localhost')).toMatchObject({ ipv6Only: true, rewriteHost: true });
  });
});

describe('resolveHost', () => {
  const table = buildRoutes({
    ...base,
    processes: [proc('r1', 'dev')],
    ports: [port(3000, 'r1', 'dev')],
  });

  it('normalises case, a trailing dot and a port', () => {
    for (const host of [
      'shop.localhost',
      'SHOP.Localhost',
      'shop.localhost.',
      'shop.localhost:443',
    ]) {
      expect(resolveHost(table, host)).toMatchObject({ kind: 'forward', port: 3000 });
    }
  });

  it('answers not-running, unknown and forbidden', () => {
    expect(resolveHost(table, 'api.shop.localhost')).toMatchObject({ kind: 'not-running' });
    expect(resolveHost(table, 'nope.localhost')).toEqual({
      kind: 'unknown',
      known: ['api.shop.localhost', 'shop.localhost'],
    });
    for (const host of [
      'example.com',
      'localhost',
      '127.0.0.1',
      '[::1]:443',
      undefined,
      'evil.localhost.example.com',
    ]) {
      expect(resolveHost(table, host)).toEqual({ kind: 'forbidden' });
    }
  });
});
