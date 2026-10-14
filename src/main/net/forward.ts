// Helpers shared by NestBox's HTTP proxies (the Inspector and local domains): which headers never travel
// through a proxy, host-name parsing, and the request headers a proxied request carries.

export const HOP_BY_HOP: ReadonlySet<string> = new Set([
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
const FORWARDED = new Set(['x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for']);

/** "[::1]:4020" → "[::1]"; "Shop.Localhost:443" → "shop.localhost". */
export function hostName(host: string | undefined): string {
  if (!host) return '';
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0] ?? '';
}

export function isLocalHost(host: string | undefined): boolean {
  return LOCAL_HOSTS.has(hostName(host));
}

/**
 * A proxied request's headers as a flat raw list: hop-by-hop headers dropped, Host kept (or rewritten),
 * and X-Forwarded-Host/-Proto/-For set (an incoming X-Forwarded-For is extended, the others replaced).
 */
export function proxyRequestHeaders(
  raw: readonly string[],
  opts: {
    host: string;
    proto: 'http' | 'https';
    remoteAddress: string | undefined;
    rewriteHostTo: string | null;
  },
): string[] {
  const out: string[] = [];
  let forwardedFor: string | null = null;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] ?? '';
    const value = raw[i + 1] ?? '';
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'x-forwarded-for') {
      forwardedFor = forwardedFor === null ? value : `${forwardedFor}, ${value}`;
      continue;
    }
    if (FORWARDED.has(lower)) continue;
    if (lower === 'host') {
      out.push(name, opts.rewriteHostTo ?? value);
      continue;
    }
    out.push(name, value);
  }
  const chain = [forwardedFor, opts.remoteAddress].filter((v): v is string => !!v).join(', ');
  out.push('X-Forwarded-Host', opts.host, 'X-Forwarded-Proto', opts.proto);
  if (chain) out.push('X-Forwarded-For', chain);
  return out;
}
