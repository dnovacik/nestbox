import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type {
  EntryDetail,
  EntrySummary,
  InspectorSettings,
  InspectorStatus,
} from '@shared/tools/inspector/contract';
import { createMemoryLogger } from '../../logger';
import { createEnvFileAccess } from '../env/env-files';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createInspectorTool } from './index';

let root = '';
let tool: AnyMainTool | null = null;
const servers: Server[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nestbox-inspector-'));
});
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  await rm(root, { recursive: true, force: true });
});

async function api() {
  const seen: { method?: string; url?: string; auth?: string; body: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=topsecret' });
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, seen };
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

function setup(initial: InspectorSettings = { packages: {} }) {
  let settings = initial;
  const logger = createMemoryLogger();
  const clipboard = { writeText: vi.fn() };
  tool = createInspectorTool({ logger, envFiles: createEnvFileAccess(), clipboard });
  const emit = vi.fn();
  const ctx = {
    project: makeDetectedForTest({ path: root }),
    shared: createSharedContext().forProject('p1'),
    emit,
    platform: {},
    settings: {
      get: () => settings,
      update: (fn: (s: InspectorSettings) => InspectorSettings) => (settings = fn(settings)),
    },
  } as unknown as ToolContext;
  const call = <T>(method: string, input: unknown = {}) =>
    tool?.handlers[method]?.(ctx, input) as Promise<T>;
  return { call, emit, logger, clipboard };
}

describe('inspector tool: target and lifecycle', () => {
  it('takes the target from PORT in .env, or from the setting', async () => {
    await writeFile(join(root, '.env'), 'PORT=3456\nSECRET=x\n');
    const { call } = setup();
    expect(await call<InspectorStatus>('status')).toMatchObject({
      running: false,
      target: 'http://localhost:3456',
      targetSource: 'env',
    });
    await call('setOptions', { target: 'http://127.0.0.1:9999/api' });
    expect(await call<InspectorStatus>('status')).toMatchObject({
      target: 'http://127.0.0.1:9999/api',
      targetSource: 'setting',
    });
  });

  it('refuses to start without an API address', async () => {
    const { call } = setup();
    await expect(call('start')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('refuses a port in use', async () => {
    const busy = createServer();
    servers.push(busy);
    await new Promise<void>((r) => busy.listen(0, '127.0.0.1', r));
    const port = (busy.address() as AddressInfo).port;
    const { call } = setup();
    await call('setOptions', { port, target: 'http://localhost:3000' });
    await expect(call('start')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: `Port ${port} is in use`,
    });
  });
});

describe('inspector tool: recording and replay', () => {
  async function running() {
    const backend = await api();
    const port = await freePort();
    const t = setup();
    await t.call('setOptions', { port, target: `http://localhost:${backend.port}` });
    const status = await t.call<InspectorStatus>('start');
    return { ...t, backend, port, status };
  }

  it('proxies, records with secrets masked, and reveals one on demand', async () => {
    const { call, port, status, emit, logger } = await running();
    expect(status).toMatchObject({
      running: true,
      url: `http://localhost:${port}`,
      configChanged: false,
    });
    const res = await fetch(`http://127.0.0.1:${port}/users/1?q=x`, {
      method: 'POST',
      headers: { Authorization: 'Bearer s3cr3t', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    expect(await res.json()).toEqual({ ok: true, url: '/users/1?q=x' });

    await vi.waitFor(async () => expect(await call<EntrySummary[]>('list')).toHaveLength(1));
    const [summary] = await call<EntrySummary[]>('list');
    expect(summary).toMatchObject({
      method: 'POST',
      path: '/users/1?q=x',
      status: 200,
      replayOf: null,
      error: null,
    });
    const detail = await call<EntryDetail>('get', { id: summary?.id });
    expect(JSON.stringify(detail)).not.toMatch(/s3cr3t|topsecret/);
    expect(detail.request.headers.find((h) => h.name === 'Authorization')).toEqual({
      name: 'Authorization',
      value: '••••••',
      masked: true,
    });
    expect(detail.request.body).toMatchObject({ kind: 'text', text: '{"a":1}' });
    expect(detail.response?.body).toMatchObject({
      kind: 'text',
      text: '{"ok":true,"url":"/users/1?q=x"}',
    });
    expect(await call('reveal', { id: summary?.id, side: 'response', name: 'set-cookie' })).toEqual(
      { value: 'sid=topsecret' },
    );
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith('entries', undefined));
    expect(JSON.stringify(logger.entries)).not.toMatch(/users|s3cr3t/);
  });

  it('replays as recorded and sends an edit with a kept secret header', async () => {
    const { call, port, backend } = await running();
    await fetch(`http://127.0.0.1:${port}/orders`, {
      method: 'POST',
      headers: { Authorization: 'Bearer s3cr3t' },
      body: 'one',
    });
    await vi.waitFor(async () => expect(await call<EntrySummary[]>('list')).toHaveLength(1));
    const [first] = await call<EntrySummary[]>('list');
    const replayed = await call<{ id: string }>('replay', { id: first?.id });
    const sent = await call<{ id: string }>('send', {
      from: first?.id,
      method: 'PUT',
      path: '/orders/2',
      headers: [
        { name: 'Authorization', keep: true },
        { name: 'X-Edit', value: 'yes' },
      ],
      body: 'two',
    });
    expect(backend.seen.map((s) => [s.method, s.url, s.auth, s.body])).toEqual([
      ['POST', '/orders', 'Bearer s3cr3t', 'one'],
      ['POST', '/orders', 'Bearer s3cr3t', 'one'],
      ['PUT', '/orders/2', 'Bearer s3cr3t', 'two'],
    ]);
    await vi.waitFor(async () => expect(await call<EntrySummary[]>('list')).toHaveLength(3));
    const list = await call<EntrySummary[]>('list');
    expect(list.map((e) => [e.id, e.replayOf])).toEqual([
      [sent.id, first?.id],
      [replayed.id, first?.id],
      [first?.id, null],
    ]);
  });

  it('copies a curl command to the clipboard, and clears', async () => {
    const { call, port, backend, clipboard } = await running();
    await fetch(`http://127.0.0.1:${port}/ping`);
    await vi.waitFor(async () => expect(await call<EntrySummary[]>('list')).toHaveLength(1));
    const [entry] = await call<EntrySummary[]>('list');
    await call('copyCurl', { id: entry?.id });
    expect(clipboard.writeText).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^curl -X GET 'http://localhost:${backend.port}/ping'`)),
    );
    await call('clear');
    expect(await call('list')).toEqual([]);
    await expect(call('get', { id: entry?.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('says a changed port needs a restart, and stops the server on dispose', async () => {
    const { call, port } = await running();
    await call('setOptions', { port: port === 65_535 ? port - 1 : port + 1 });
    expect((await call<InspectorStatus>('status')).configChanged).toBe(true);
    await tool?.dispose?.();
    tool = null;
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});
