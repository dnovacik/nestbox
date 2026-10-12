// Turns a .NET connection string (`Host=…;Database=…;Password=…`, or a URL) into what the panel may show:
// provider, host, port, database and, for SQLite, the file. Only address keys are kept while parsing;
// users, passwords and every other value are dropped here, in main.
import { basename, isAbsolute, resolve } from 'node:path';
import type { DbProvider } from '../../ecosystems/dotnet/detect';
import { describeUrl, type DbTarget } from './url';

export type { DbProvider };

/** The keys whose values are read (normalised: lower case, no spaces). */
const ADDRESS_KEYS = new Set([
  'server',
  'host',
  'datasource',
  'address',
  'addr',
  'networkaddress',
  'port',
  'database',
  'initialcatalog',
  'filename',
]);
/** Keys whose presence (never their value) says SQL Server. */
const SQLSERVER_HINTS = new Set([
  'initialcatalog',
  'trusted_connection',
  'integratedsecurity',
  'encrypt',
  'trustservercertificate',
  'multipleactiveresultsets',
]);
const DEFAULT_PORTS: Record<string, number> = {
  postgresql: 5432,
  sqlserver: 1433,
  mysql: 3306,
  mongodb: 27017,
};
const SQLITE_FILE = /\.(db|sqlite3?)$/i;

const normalise = (key: string) => key.replace(/\s+/g, '').toLowerCase();

/** Address values by normalised key, and the names of the other keys (their values are never kept). */
function tokenize(value: string): { values: Map<string, string>; keys: Set<string> } {
  const values = new Map<string, string>();
  const keys = new Set<string>();
  let i = 0;
  while (i < value.length) {
    const eq = value.indexOf('=', i);
    if (eq === -1) break;
    const key = normalise(value.slice(i, eq).replace(/^[;\s]+/, ''));
    let j = eq + 1;
    while (j < value.length && /\s/.test(value[j] ?? '')) j++;
    let text = '';
    const quote = value[j];
    if (quote === '"' || quote === "'") {
      j++;
      while (j < value.length) {
        if (value[j] === quote) {
          if (value[j + 1] === quote) {
            text += quote;
            j += 2;
            continue;
          }
          j++;
          break;
        }
        text += value[j];
        j++;
      }
      const end = value.indexOf(';', j);
      i = end === -1 ? value.length : end + 1;
    } else {
      const end = value.indexOf(';', j);
      text = value.slice(j, end === -1 ? value.length : end).trim();
      i = end === -1 ? value.length : end + 1;
    }
    if (key === '') continue;
    keys.add(key);
    if (ADDRESS_KEYS.has(key)) values.set(key, text);
  }
  return { values, keys };
}

const portOf = (text: string | undefined): number | null => {
  if (text === undefined || !/^\d{1,5}$/.test(text.trim())) return null;
  const port = Number(text);
  return port >= 1 && port <= 65_535 ? port : null;
};

const first = (values: Map<string, string>, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const v = values.get(key);
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
};

function providerOf(
  values: Map<string, string>,
  keys: Set<string>,
  providers: readonly DbProvider[],
): DbProvider | 'unknown' {
  const [only] = providers;
  if (providers.length === 1 && only !== undefined) return only;
  const server = (first(values, 'server', 'datasource', 'address') ?? '').toLowerCase();
  if (keys.has('host')) return 'postgresql';
  // host\Instance is SQL Server's syntax only.
  if ([...keys].some((k) => SQLSERVER_HINTS.has(k)) || /^(tcp|np):|^\(localdb\)|\\/.test(server))
    return 'sqlserver';
  const path = first(values, 'filename', 'datasource') ?? '';
  if (SQLITE_FILE.test(path) || path === ':memory:') return 'sqlite';
  return 'unknown';
}

const LOCAL_NAMES = new Set(['.', '(local)', 'localhost']);

type Described = { target: DbTarget; skip: string | null };

function sqlServer(address: string, database: string | null): Described {
  const at = (host: string | null, port: number | null, skip: string | null): Described => ({
    target: { provider: 'sqlserver', host, port, database, file: null },
    skip,
  });
  const lower = address.toLowerCase();
  if (lower.startsWith('np:')) return at(null, null, "Named pipes aren't checked");
  if (lower.startsWith('(localdb)')) return at(null, null, 'LocalDB runs on demand');
  const [name = '', portText] = address.replace(/^tcp:/i, '').split(',');
  const [server = '', instance] = name.trim().split('\\');
  const host = LOCAL_NAMES.has(server.toLowerCase()) ? 'localhost' : server || null;
  const port = portOf(portText);
  if (instance !== undefined && port === null)
    return at(host, null, 'A named instance is found through SQL Browser');
  return at(
    host,
    port ?? DEFAULT_PORTS['sqlserver'] ?? null,
    host === null ? 'No server in the connection string' : null,
  );
}

/** host, host:port or a,b (the first host); with the Port key winning. */
function hostAndPort(
  address: string | undefined,
  portKey: string | undefined,
  provider: string,
): { host: string | null; port: number | null } {
  const [firstHost = ''] = (address ?? '').split(',');
  const match = /^([^:]+)(?::(\d{1,5}))?$/.exec(firstHost.replace(/^tcp:/i, '').trim());
  const host = match?.[1]
    ? LOCAL_NAMES.has(match[1].toLowerCase())
      ? 'localhost'
      : match[1]
    : null;
  return { host, port: portOf(portKey) ?? portOf(match?.[2]) ?? DEFAULT_PORTS[provider] ?? null };
}

/**
 * The target of one connection string, and why reachability isn't checked (null when it can be). The
 * raw value never leaves this function.
 */
export function describeConnectionString(
  value: string,
  opts: { providers: readonly DbProvider[]; dir: string },
): Described {
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('file:')) {
    return { target: describeUrl(trimmed, opts.dir), skip: null };
  }
  const { values, keys } = tokenize(trimmed);
  const provider = providerOf(values, keys, opts.providers);
  const database = first(values, 'database', 'initialcatalog') ?? null;

  switch (provider) {
    case 'sqlite': {
      const path = first(values, 'datasource', 'filename') ?? '';
      const target = (file: string | null): DbTarget => ({
        provider: 'sqlite',
        host: null,
        port: null,
        database: path ? basename(path) : null,
        file,
      });
      if (path === ':memory:') return { target: target(null), skip: 'An in-memory database' };
      if (/\|DataDirectory\|/i.test(path))
        return { target: target(null), skip: '|DataDirectory| is set by the app at run time' };
      if (path === '')
        return { target: target(null), skip: 'No SQLite file in the connection string' };
      return {
        target: target(isAbsolute(path) ? resolve(path) : resolve(opts.dir, path)),
        skip: null,
      };
    }
    case 'sqlserver':
      return sqlServer(
        first(values, 'server', 'datasource', 'address', 'addr', 'networkaddress') ?? '',
        database,
      );
    case 'postgresql':
    case 'mysql':
    case 'mongodb': {
      const { host, port } = hostAndPort(
        first(values, 'host', 'server', 'datasource'),
        values.get('port'),
        provider,
      );
      return {
        target: { provider, host, port, database, file: null },
        skip: host === null ? 'No host in the connection string' : null,
      };
    }
    case 'unknown': {
      const address = first(
        values,
        'server',
        'host',
        'datasource',
        'address',
        'addr',
        'networkaddress',
      );
      const [name, portText] = (address ?? '').replace(/^tcp:/i, '').split(',');
      const host = name?.trim() ? name.trim() : null;
      return {
        target: {
          provider: 'unknown',
          host,
          port: portOf(values.get('port')) ?? portOf(portText),
          database,
          file: null,
        },
        skip: 'The database provider is unknown',
      };
    }
  }
}
