// One health check request: GET, headers only, no redirects followed. The result's reason is a code, never
// the URL (it may come from .env).
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { CheckResult } from '@shared/tools/health/contract';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const TLS_CODES = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/;

export interface CheckOptions {
  timeoutMs?: number;
  /** One expected status; otherwise 200–399 is healthy. */
  expect?: number;
  now?: () => number;
}

export function checkUrl(url: string, opts: CheckOptions): Promise<CheckResult> {
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const now = opts.now ?? Date.now;
  const started = now();
  return new Promise<CheckResult>((resolve) => {
    let done = false;
    const finish = (result: Omit<CheckResult, 'at' | 'ms'> & { ms?: number | null }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      req.destroy();
      resolve({ ms: null, ...result, at: now() });
    };
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      resolve({ state: 'config', status: null, ms: null, reason: 'invalid URL', at: now() });
      return;
    }
    const https = target.protocol === 'https:';
    const request = https ? httpsRequest : httpRequest;
    const req = request(target, {
      method: 'GET',
      headers: { accept: '*/*', 'user-agent': 'NestBox health check' },
      // Dev servers on this machine (NestBox's own static server too) often use self-signed certificates.
      ...(https && LOOPBACK.has(target.hostname) ? { rejectUnauthorized: false } : {}),
    });
    const timer = setTimeout(() => finish({ state: 'fail', status: null, reason: 'timeout' }), timeoutMs);
    req.once('response', (res) => {
      const status = res.statusCode ?? 0;
      const healthy = opts.expect === undefined ? status >= 200 && status < 400 : status === opts.expect;
      // Headers are enough: the body is never read.
      res.resume();
      finish({ state: healthy ? 'ok' : 'fail', status, ms: now() - started, reason: healthy ? null : `status ${status}` });
    });
    req.once('error', (error: NodeJS.ErrnoException) => {
      const code = error.code ?? 'error';
      finish({ state: 'fail', status: null, reason: TLS_CODES.test(code) ? 'TLS' : code });
    });
    req.end();
  });
}
