// Env-key checks: the value is read in main and only its origin is used. Credentials and the query string are
// dropped, and only "host:port" is ever shown.

function parseHttp(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** "host:port" of an http(s) URL; null for anything else. */
export function describeHttpUrl(value: string): string | null {
  return parseHttp(value)?.host ?? null;
}

export type EnvUrl = { ok: true; url: string; host: string } | { ok: false; reason: string };

/** The URL an env-key check requests: the value's origin plus the check's path. */
export function envCheckUrl(value: string | undefined, path: string): EnvUrl {
  if (!value) return { ok: false, reason: 'not set in .env' };
  const url = parseHttp(value.trim());
  if (!url) return { ok: false, reason: 'not an http(s) URL' };
  return { ok: true, url: `${url.protocol}//${url.host}${path}`, host: url.host };
}
