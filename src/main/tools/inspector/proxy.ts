// The inspector's proxy: every request to the inspector port goes on to the API, and both sides are recorded
// (capped) in memory. Replay and edited sends use the same outbound path, without a client.
import { randomUUID } from 'node:crypto';
import {
  type ClientRequest,
  type IncomingMessage,
  request as httpRequest,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import { MAX_REQUEST_BYTES } from '@shared/tools/inspector/contract';
import { Capture, type Entry, type HeaderPairs, headerPairs } from './record';

export const HEADERS_TIMEOUT_MS = 30_000;
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface OutboundRequest {
  method: string;
  /** Path and query, starting with /. */
  path: string;
  headers: HeaderPairs;
}

/** "[::1]:4020" → "[::1]"; "localhost:4020" → "localhost". */
export function hostName(host: string | undefined): string {
  if (!host) return '';
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0] ?? '';
}

export function isLocalHost(host: string | undefined): boolean {
  return LOCAL_HOSTS.has(hostName(host));
}

/** The target's base path joined with the request's path and query. */
export function outboundUrl(target: URL, path: string): URL {
  const base = target.pathname.replace(/\/+$/, '');
  return new URL(`${target.protocol}//${target.host}${base}${path}`);
}

/** Headers for the API: hop-by-hop ones dropped, Host set to the target's. */
function forwardHeaders(
  headers: HeaderPairs,
  target: URL,
  extra: HeaderPairs = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of [...headers, ...extra]) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === 'host' || lower === 'content-length') continue;
    const key = Object.keys(out).find((k) => k.toLowerCase() === lower) ?? name;
    out[key] =
      out[key] === undefined ? value : `${out[key]}${lower === 'cookie' ? '; ' : ', '}${value}`;
  }
  out.host = target.host;
  return out;
}

function open(
  target: URL,
  req: OutboundRequest,
  extra: HeaderPairs,
  contentLength: number | null,
): ClientRequest {
  const url = outboundUrl(target, req.path);
  const headers = forwardHeaders(req.headers, target, extra);
  if (contentLength !== null) headers['content-length'] = String(contentLength);
  const https = url.protocol === 'https:';
  // The target is always this machine, where dev servers use self-signed certificates.
  return (https ? httpsRequest : httpRequest)(url, {
    method: req.method,
    headers,
    ...(https ? { rejectUnauthorized: false } : {}),
  });
}

/** Response headers for the client: hop-by-hop ones dropped (Node sets its own framing). */
function responseHeaders(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] as string;
    if (HOP_BY_HOP.has(name.toLowerCase())) continue;
    out.push(name, raw[i + 1] as string);
  }
  return out;
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException)?.code ?? 'error';
}

export interface ProxyDeps {
  /** Read per request; null when no API address is known. */
  target(): URL | null;
  onEntry(entry: Entry): void;
  now?(): number;
  headersTimeoutMs?: number;
}

export function createProxyHandler(deps: ProxyDeps) {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.headersTimeoutMs ?? HEADERS_TIMEOUT_MS;

  return (req: IncomingMessage, res: ServerResponse): void => {
    const sendJson = (status: number, body: object) => {
      if (res.headersSent || res.destroyed) return;
      const text = JSON.stringify(body);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(Buffer.byteLength(text)),
      });
      res.end(text);
    };
    // DNS rebinding: only this machine's names may reach the API through the inspector.
    if (!isLocalHost(req.headers.host)) {
      req.resume();
      sendJson(403, { error: 'Forbidden host' });
      return;
    }

    const started = now();
    const method = (req.method ?? 'GET').toUpperCase();
    const path = req.url && req.url.startsWith('/') ? req.url : '/';
    const reqHeaders = headerPairs(req.rawHeaders);
    const reqCapture = new Capture();
    const resCapture = new Capture();
    let status: number | null = null;
    let resHeaders: HeaderPairs = [];
    let error: string | null = null;
    let recorded = false;
    const record = () => {
      if (recorded) return;
      recorded = true;
      deps.onEntry({
        id: randomUUID(),
        at: started,
        method,
        path,
        request: { headers: reqHeaders, body: reqCapture.buffer(), bytes: reqCapture.bytes },
        response:
          status === null
            ? null
            : { status, headers: resHeaders, body: resCapture.buffer(), bytes: resCapture.bytes },
        ms: Math.max(0, now() - started),
        replayOf: null,
        error,
      });
    };

    const target = deps.target();
    if (!target) {
      req.resume();
      error = 'no-target';
      status = 502;
      sendJson(502, { error: 'No API address: set one in NestBox, or PORT in .env' });
      record();
      return;
    }

    const remote = req.socket.remoteAddress ?? '127.0.0.1';
    const outbound = open(
      target,
      { method, path, headers: reqHeaders },
      [
        ['X-Forwarded-For', remote],
        ['X-Forwarded-Host', req.headers.host ?? ''],
        ['X-Forwarded-Proto', 'http'],
      ],
      null,
    );
    const timer = setTimeout(() => {
      error = 'timeout';
      outbound.destroy();
      status = 504;
      sendJson(504, { error: 'The API did not answer in time' });
      record();
    }, timeoutMs);

    outbound.on('response', (upstream) => {
      clearTimeout(timer);
      status = upstream.statusCode ?? 502;
      resHeaders = headerPairs(upstream.rawHeaders);
      if (res.destroyed) {
        upstream.resume();
        return;
      }
      res.writeHead(status, upstream.statusMessage, responseHeaders(upstream.rawHeaders));
      upstream.on('data', (chunk: Buffer) => {
        resCapture.push(chunk);
        res.write(chunk);
      });
      upstream.on('end', () => {
        res.end();
        record();
      });
      upstream.on('error', () => {
        error = 'aborted';
        res.destroy();
        record();
      });
    });
    outbound.on('error', (e) => {
      clearTimeout(timer);
      if (error === 'timeout' || error === 'too-large') return;
      error = errorCode(e);
      if (res.headersSent) res.destroy();
      else {
        status = 502;
        sendJson(502, { error: 'API unreachable', code: error });
      }
      record();
    });

    req.on('data', (chunk: Buffer) => {
      reqCapture.push(chunk);
      if (reqCapture.bytes > MAX_REQUEST_BYTES) {
        if (error === 'too-large') return;
        error = 'too-large';
        clearTimeout(timer);
        outbound.destroy();
        status = 413;
        sendJson(413, { error: 'Request body too large for the inspector' });
        record();
        req.destroy();
        return;
      }
      outbound.write(chunk);
    });
    req.on('end', () => outbound.end());
    req.on('error', () => outbound.destroy());
    // The client went away before the answer was complete.
    res.on('close', () => {
      if (!res.writableFinished) outbound.destroy();
    });
  };
}

/** Sends a request straight to the API (replay, edited send) and records the result like a proxied one. */
export function sendRequest(
  target: URL,
  req: OutboundRequest & { body: Buffer },
  opts: { replayOf: string; now?: () => number; headersTimeoutMs?: number },
): Promise<Entry> {
  const now = opts.now ?? Date.now;
  const started = now();
  return new Promise((resolve) => {
    const base = {
      id: randomUUID(),
      at: started,
      method: req.method,
      path: req.path,
      replayOf: opts.replayOf,
    };
    const kept = new Capture();
    kept.push(req.body);
    const request = { headers: req.headers, body: kept.buffer(), bytes: req.body.length };
    let done = false;
    const finish = (entry: Omit<Entry, keyof typeof base | 'request'>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...base, request, ...entry });
    };
    const outbound = open(target, req, [], req.body.length);
    const timer = setTimeout(() => {
      outbound.destroy();
      finish({ response: null, ms: now() - started, error: 'timeout' });
    }, opts.headersTimeoutMs ?? HEADERS_TIMEOUT_MS);
    outbound.on('response', (upstream) => {
      clearTimeout(timer);
      const capture = new Capture();
      upstream.on('data', (chunk: Buffer) => capture.push(chunk));
      upstream.on('end', () =>
        finish({
          response: {
            status: upstream.statusCode ?? 0,
            headers: headerPairs(upstream.rawHeaders),
            body: capture.buffer(),
            bytes: capture.bytes,
          },
          ms: now() - started,
          error: null,
        }),
      );
      upstream.on('error', () => finish({ response: null, ms: now() - started, error: 'aborted' }));
    });
    outbound.on('error', (e) =>
      finish({ response: null, ms: now() - started, error: errorCode(e) }),
    );
    outbound.end(req.body);
  });
}
