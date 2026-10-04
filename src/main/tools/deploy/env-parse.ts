// Key names from the platforms' env and secret listings. Vercel's and Netlify's JSON carries values: only
// the keys leave these functions, and callers drop the output right away.
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Env names as platforms accept them; anything else is dropped rather than shown. */
const KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,255}$/;

function json(text: string): unknown {
  const trimmed = text.trim();
  for (const candidate of [trimmed, trimmed.slice(Math.max(0, trimmed.search(/^[[{]/m)))]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

function unique(keys: Iterable<unknown>): string[] {
  const out: string[] = [];
  for (const k of keys) if (typeof k === 'string' && KEY.test(k) && !out.includes(k)) out.push(k);
  return out;
}

/** `vercel env ls <environment> --format json`: `{ envs: [{ key, target: [...] }] }`. */
export function parseVercelEnv(text: string, environment: string): string[] | null {
  const value = json(text);
  if (!isObj(value) || !Array.isArray(value['envs'])) return null;
  return unique(
    value['envs']
      .filter(isObj)
      .filter((e) => !Array.isArray(e['target']) || e['target'].includes(environment))
      .map((e) => e['key']),
  );
}

/** `netlify env:list --json --context <c>`: `{ KEY: value }`. */
export function parseNetlifyEnv(text: string): string[] | null {
  const value = json(text);
  return isObj(value) ? unique(Object.keys(value)) : null;
}

/** `wrangler secret list --format json`: `[{ name, type }]`. */
export function parseWorkersSecrets(text: string): string[] | null {
  const value = json(text);
  return Array.isArray(value) ? unique(value.filter(isObj).map((s) => s['name'])) : null;
}

/** `wrangler pages secret list`: a heading line, then `  - NAME: Value Encrypted` per secret. */
export function parsePagesSecrets(text: string): string[] | null {
  if (!/has access to the following secrets/.test(text)) return null;
  return unique([...text.matchAll(/^\s+- ([^:\s]+): /gm)].map((m) => m[1]));
}

/** `flyctl secrets list --json`: `[{ name, digest }]`. */
export function parseFlySecrets(text: string): string[] | null {
  const value = json(text);
  return Array.isArray(value) ? unique(value.filter(isObj).map((s) => s['name'])) : null;
}
