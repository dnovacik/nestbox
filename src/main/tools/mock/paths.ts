// Matching a request against the mock routes: segments, :name for one segment, a final * for the rest.
// The first enabled route that matches wins.
import type { MockMethod, MockRoute } from '@shared/tools/mock/contract';

type Segment =
  { kind: 'literal'; value: string } | { kind: 'param'; name: string } | { kind: 'rest' };

const cache = new Map<string, Segment[]>();

function split(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

export function compilePath(pattern: string): Segment[] {
  const hit = cache.get(pattern);
  if (hit) return hit;
  const segments: Segment[] = split(pattern).map((s) =>
    s === '*'
      ? { kind: 'rest' }
      : s.startsWith(':') && s.length > 1
        ? { kind: 'param', name: s.slice(1) }
        : { kind: 'literal', value: s },
  );
  if (cache.size > 1_000) cache.clear();
  cache.set(pattern, segments);
  return segments;
}

function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The params when path (no query) matches pattern; null otherwise. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const segments = compilePath(pattern);
  const parts = split(path);
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as Segment;
    if (segment.kind === 'rest') return params;
    const raw = parts[i];
    if (raw === undefined) return null;
    const part = decode(raw);
    if (part === null) return null;
    if (segment.kind === 'literal' && segment.value !== part) return null;
    if (segment.kind === 'param') params[segment.name] = part;
  }
  return parts.length === segments.length ? params : null;
}

function methodMatches(routeMethod: MockMethod, method: string): boolean {
  if (routeMethod === 'ANY') return true;
  return routeMethod === method || (method === 'HEAD' && routeMethod === 'GET');
}

export function matchRoute(
  routes: readonly MockRoute[],
  method: string,
  path: string,
): { route: MockRoute; params: Record<string, string> } | null {
  for (const route of routes) {
    if (!route.enabled || !methodMatches(route.method, method)) continue;
    const params = matchPath(route.path, path);
    if (params) return { route, params };
  }
  return null;
}
