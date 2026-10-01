import type { IncomingMessage, ServerResponse } from 'node:http';
import sirv from 'sirv';

export interface RequestLog {
  method: string;
  /** Path only: query strings can carry tokens, so they are never logged. */
  path: string;
  status: number;
  /** Total time, latency included. */
  ms: number;
}

export interface StaticHandlerOptions {
  folder: string;
  /** Unknown routes return index.html (client-side routers). */
  spa: boolean;
  cors: boolean;
  /** Cache-Control: no-store on every response. */
  noCache: boolean;
  /** Added to every response. */
  latencyMs: number;
  onRequest(entry: RequestLog): void;
}

/**
 * True for a path with a dot-segment (`/.env`, `/.git/config`, `/a/../b`), percent-encoded or not.
 * Checked before sirv: its dev mode ignores `dotfiles: false`, and .env must never be served.
 */
export function isHiddenPath(path: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return true;
  }
  return decoded.split(/[\\/]/).some((segment) => segment.startsWith('.'));
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

/** Serves a folder: latency → headers → dotfile guard → sirv → 404. */
export function createStaticHandler(opts: StaticHandlerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  // dev: re-reads the folder on each request, so a rebuilt dist is served without a restart.
  const files = sirv(opts.folder, { dev: true, etag: true, single: opts.spa, dotfiles: false });

  return (req, res) => {
    const started = Date.now();
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    res.once('finish', () =>
      opts.onRequest({ method: req.method ?? 'GET', path, status: res.statusCode, ms: Date.now() - started }),
    );

    const handle = () => {
      if (opts.cors) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Max-Age': '600',
          });
          res.end();
          return;
        }
      }
      if (opts.noCache) res.setHeader('Cache-Control', 'no-store');
      // No SPA fallback either: a hidden path is simply not there.
      if (isHiddenPath(path)) {
        notFound(res);
        return;
      }
      files(req, res, () => notFound(res));
    };

    if (opts.latencyMs > 0) setTimeout(handle, opts.latencyMs);
    else handle();
  };
}
