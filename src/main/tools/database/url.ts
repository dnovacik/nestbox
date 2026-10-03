// Turns a database URL into what the panel may show: provider, host, port, database name and, for SQLite,
// the file. The user, the password and every query parameter are dropped here, in main; the raw value
// never reaches the renderer or the log.
import { isAbsolute, resolve } from 'node:path';

export interface DbTarget {
  /** postgresql, mysql, sqlserver, mongodb, cockroachdb, sqlite, accelerate (a Prisma proxy) or unknown. */
  provider: string;
  host: string | null;
  port: number | null;
  database: string | null;
  /** SQLite only: the database file, resolved the way Prisma does (relative to the schema folder). */
  file: string | null;
}

const UNKNOWN: DbTarget = { provider: 'unknown', host: null, port: null, database: null, file: null };

/** Scheme → provider and default port. mongodb+srv has no port: DNS SRV records hold it. */
const SCHEMES: Record<string, { provider: string; port: number | null }> = {
  postgresql: { provider: 'postgresql', port: 5432 },
  postgres: { provider: 'postgresql', port: 5432 },
  mysql: { provider: 'mysql', port: 3306 },
  mariadb: { provider: 'mysql', port: 3306 },
  mongodb: { provider: 'mongodb', port: 27017 },
  'mongodb+srv': { provider: 'mongodb', port: null },
  cockroachdb: { provider: 'cockroachdb', port: 26257 },
  prisma: { provider: 'accelerate', port: null },
  'prisma+postgres': { provider: 'accelerate', port: null },
};

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** `sqlserver://host[:port];database=x;user=…;password=…`: only the host, port and database are kept. */
function describeSqlServer(rest: string): DbTarget {
  const [address = '', ...params] = rest.split(';');
  const match = /^([^:\\]+)(?:\\[^:]*)?(?::(\d{1,5}))?$/.exec(address.trim());
  if (!match?.[1]) return UNKNOWN;
  let database: string | null = null;
  for (const param of params) {
    const eq = param.indexOf('=');
    const key = param.slice(0, eq).trim().toLowerCase();
    if (eq > 0 && (key === 'database' || key === 'initial catalog')) database = param.slice(eq + 1).trim() || null;
  }
  return { provider: 'sqlserver', host: match[1], port: match[2] ? Number(match[2]) : 1433, database, file: null };
}

export function describeUrl(raw: string, schemaDir: string): DbTarget {
  const value = raw.trim();
  if (value.startsWith('file:')) {
    const path = safeDecode(value.slice('file:'.length).split('?')[0] ?? '');
    if (path === '') return UNKNOWN;
    const file = isAbsolute(path) ? resolve(path) : resolve(schemaDir, path);
    return { provider: 'sqlite', host: null, port: null, database: path.split(/[\\/]/).pop() ?? null, file };
  }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)?.[1]?.toLowerCase();
  if (scheme === 'sqlserver') return describeSqlServer(value.slice('sqlserver://'.length));
  const known = scheme === undefined ? undefined : SCHEMES[scheme];
  if (!known) return UNKNOWN;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return UNKNOWN;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === '') return UNKNOWN;
  const database = known.provider === 'accelerate' ? null : safeDecode(url.pathname.replace(/^\//, '').split('/')[0] ?? '') || null;
  return { provider: known.provider, host, port: url.port ? Number(url.port) : known.port, database, file: null };
}
