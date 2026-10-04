// The mock server's request handler. Requests are read and dropped: headers and bodies can carry the user's
// tokens, so only the method, the path (no query), the status and the time reach the request log.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PackageMock } from '@shared/tools/mock/contract';
import { renderBody } from '@shared/tools/mock/template';
import { matchRoute } from './paths';

export const MAX_REQUEST_BYTES = 1024 * 1024;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const CONTENT_TYPES = {
  json: 'application/json; charset=utf-8',
  text: 'text/plain; charset=utf-8',
} as const;
const NO_BODY = new Set([204, 304]);

export interface MockHandlerDeps {
  /** Read on every request, so edits apply without a restart. */
  config(): PackageMock;
  log(stream: 'stdout' | 'stderr', text: string): void;
  onRequest?(): void;
  now?(): number;
}

/** The hostname of a Host header, without the port ("[::1]:4010" → "[::1]"). */
function hostName(host: string | undefined): string {
  if (!host) return '';
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0] ?? '';
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  return origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin',
      }
    : { 'Access-Control-Allow-Origin': '*' };
}

function send(
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: string,
  withBody: boolean,
): void {
  if (res.headersSent || res.destroyed) return;
  const payload = withBody && !NO_BODY.has(status) ? body : '';
  res.writeHead(status, { ...headers, 'Content-Length': String(Buffer.byteLength(payload)) });
  res.end(payload);
}

export function createMockHandler(deps: MockHandlerDeps) {
  const now = deps.now ?? Date.now;

  return (req: IncomingMessage, res: ServerResponse): void => {
    const started = now();
    const method = (req.method ?? 'GET').toUpperCase();
    let path = '/';
    let query: Record<string, string> = {};
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      path = url.pathname;
      query = Object.fromEntries(url.searchParams);
    } catch {
      // A malformed target is answered as an unmatched path.
    }
    const finish = (status: number, note: string) => {
      deps.onRequest?.();
      deps.log(
        status >= 500 ? 'stderr' : 'stdout',
        `${method} ${path} → ${status} · ${Math.max(0, now() - started)} ms · ${note}`,
      );
    };

    // DNS rebinding: a page on another site must not reach the mock through a name that points at 127.0.0.1.
    if (!LOCAL_HOSTS.has(hostName(req.headers.host))) {
      send(res, 403, { 'Content-Type': CONTENT_TYPES.text }, 'Forbidden host', true);
      req.resume();
      finish(403, 'host refused');
      return;
    }
    const cors = corsHeaders(req);

    if (method === 'OPTIONS' && req.headers['access-control-request-method']) {
      const allowHeaders = req.headers['access-control-request-headers'];
      send(
        res,
        204,
        {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
          ...(allowHeaders ? { 'Access-Control-Allow-Headers': allowHeaders } : {}),
          'Access-Control-Max-Age': '600',
        },
        '',
        false,
      );
      req.resume();
      finish(204, 'preflight');
      return;
    }

    let received = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_REQUEST_BYTES && !tooLarge) {
        tooLarge = true;
        send(
          res,
          413,
          { ...cors, 'Content-Type': CONTENT_TYPES.json, Connection: 'close' },
          '{"error":"Request body too large"}',
          true,
        );
        finish(413, 'body too large');
        req.destroy();
      }
    });
    req.on('error', () => undefined);
    req.on('end', () => {
      if (tooLarge) return;
      const config = deps.config();
      const match = matchRoute(config.routes, method, path);
      const delay = config.delayMs + (match?.route.delayMs ?? 0);
      const respond = () => {
        const base = {
          ...cors,
          'Cache-Control': 'no-store',
          'X-NestBox-Mock': match?.route.id ?? 'none',
        };
        const withBody = method !== 'HEAD';
        if (!match) {
          send(
            res,
            404,
            { ...base, 'Content-Type': CONTENT_TYPES.json },
            JSON.stringify({ error: 'No mock route', method, path }),
            withBody,
          );
          finish(404, 'no route');
          return;
        }
        const label = `${match.route.method} ${match.route.path}`;
        const fail = config.failAll.on
          ? config.failAll
          : match.route.fail.on
            ? match.route.fail
            : null;
        if (fail) {
          send(
            res,
            fail.status,
            { ...base, 'Content-Type': CONTENT_TYPES.json },
            '{"error":"Mocked failure"}',
            withBody,
          );
          finish(fail.status, `${label} · failed`);
          return;
        }
        const route = match.route;
        const headers: Record<string, string> = {
          ...base,
          'Content-Type': CONTENT_TYPES[route.contentType],
        };
        for (const h of route.headers) headers[h.name] = h.value;
        send(
          res,
          route.status,
          headers,
          renderBody(route.body, { params: match.params, query }, route.contentType),
          withBody,
        );
        finish(route.status, label);
      };
      if (delay <= 0) return respond();
      const timer = setTimeout(respond, delay);
      // The client gave up: nothing to send.
      res.once('close', () => clearTimeout(timer));
    });
  };
}
