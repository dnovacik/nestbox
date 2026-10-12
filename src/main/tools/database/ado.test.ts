import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeConnectionString, type DbProvider } from './ado';

const DIR = resolve('/dev/shop');
const SECRET = 's3cr3t';
const describe_ = (value: string, providers: DbProvider[] = []) =>
  describeConnectionString(value, { providers, dir: DIR });
const target = (value: string, providers: DbProvider[] = []) => describe_(value, providers).target;

describe('describeConnectionString', () => {
  it('reads Npgsql strings: host, port, database and host lists', () => {
    expect(
      describe_(`Host=localhost;Port=5433;Database=shop;Username=u;Password=${SECRET}`, [
        'postgresql',
      ]),
    ).toEqual({
      target: {
        provider: 'postgresql',
        host: 'localhost',
        port: 5433,
        database: 'shop',
        file: null,
      },
      skip: null,
    });
    expect(target('Host=a.local,b.local;Database=shop', ['postgresql'])).toMatchObject({
      host: 'a.local',
      port: 5432,
    });
    expect(target('Host=db:6000;Database=shop', ['postgresql'])).toMatchObject({
      host: 'db',
      port: 6000,
    });
  });

  it('reads SQL Server addresses: tcp:, a port after a comma, the default port and local names', () => {
    expect(
      target(`Server=tcp:sql.local,1444;Initial Catalog=Shop;User ID=sa;Password=${SECRET}`, [
        'sqlserver',
      ]),
    ).toEqual({
      provider: 'sqlserver',
      host: 'sql.local',
      port: 1444,
      database: 'Shop',
      file: null,
    });
    expect(target('Data Source=db;Database=Shop', ['sqlserver'])).toMatchObject({
      host: 'db',
      port: 1433,
      database: 'Shop',
    });
    expect(target('Server=(local);Database=Shop', ['sqlserver'])).toMatchObject({
      host: 'localhost',
      port: 1433,
    });
    expect(target('Server=.,1500;Database=Shop', ['sqlserver'])).toMatchObject({
      host: 'localhost',
      port: 1500,
    });
  });

  it('does not check named instances, LocalDB or named pipes, and says why', () => {
    expect(describe_('Server=.\\SQLEXPRESS;Database=Shop', ['sqlserver'])).toEqual({
      target: {
        provider: 'sqlserver',
        host: 'localhost',
        port: null,
        database: 'Shop',
        file: null,
      },
      skip: 'A named instance is found through SQL Browser',
    });
    expect(
      describe_('Server=(localdb)\\MSSQLLocalDB;Database=Shop;Trusted_Connection=True').skip,
    ).toBe('LocalDB runs on demand');
    expect(describe_('Server=np:\\\\.\\pipe\\sql\\query;Database=Shop', ['sqlserver']).skip).toBe(
      "Named pipes aren't checked",
    );
    // A named instance with a port is a plain TCP address.
    expect(describe_('Server=db\\PROD,1433;Database=Shop', ['sqlserver'])).toMatchObject({
      target: { host: 'db', port: 1433 },
      skip: null,
    });
  });

  it('reads MySQL strings', () => {
    expect(target(`Server=db;Port=3307;Database=shop;Uid=root;Pwd=${SECRET}`, ['mysql'])).toEqual({
      provider: 'mysql',
      host: 'db',
      port: 3307,
      database: 'shop',
      file: null,
    });
    expect(target('Server=db;Database=shop', ['mysql'])).toMatchObject({ port: 3306 });
  });

  it('resolves SQLite files from the package folder and skips in-memory databases', () => {
    expect(describe_('Data Source=app.db', ['sqlite'])).toEqual({
      target: {
        provider: 'sqlite',
        host: null,
        port: null,
        database: 'app.db',
        file: resolve(DIR, 'app.db'),
      },
      skip: null,
    });
    expect(target('Filename=data/shop.sqlite')).toMatchObject({
      provider: 'sqlite',
      file: resolve(DIR, 'data/shop.sqlite'),
    });
    expect(describe_('Data Source=:memory:', ['sqlite']).skip).toBe('An in-memory database');
    expect(describe_('Data Source=|DataDirectory|\\app.db', ['sqlite']).skip).toBe(
      '|DataDirectory| is set by the app at run time',
    );
  });

  it('hands URLs to describeUrl', () => {
    expect(describe_(`postgres://u:${SECRET}@db:6543/shop`)).toEqual({
      target: { provider: 'postgresql', host: 'db', port: 6543, database: 'shop', file: null },
      skip: null,
    });
    expect(target('mongodb://localhost/shop', ['mongodb'])).toMatchObject({
      provider: 'mongodb',
      port: 27017,
    });
  });

  it('keeps quoted values whole, with doubled quotes and odd key spelling', () => {
    const value = `Host="db;x=y";PASSWORD="a;b=""c"";Port=5432";  data base = shop ;`;
    expect(target(value, ['postgresql'])).toEqual({
      provider: 'postgresql',
      host: 'db;x=y',
      port: 5432,
      database: 'shop',
      file: null,
    });
    expect(target(`Server='sql';Initial  Catalog='Sh''op'`, ['sqlserver'])).toMatchObject({
      host: 'sql',
      database: "Sh'op",
    });
  });

  it('picks the provider from the string when references are ambiguous or missing', () => {
    expect(target('Host=db;Database=shop', ['postgresql', 'sqlite']).provider).toBe('postgresql');
    expect(target('Data Source=app.db', ['postgresql', 'sqlite']).provider).toBe('sqlite');
    expect(target('Server=db;Database=Shop;Integrated Security=true').provider).toBe('sqlserver');
    expect(target('Server=db;Database=Shop;TrustServerCertificate=True').provider).toBe(
      'sqlserver',
    );
    expect(describe_('Server=db,1500;Database=Shop;Uid=x')).toEqual({
      target: { provider: 'unknown', host: 'db', port: 1500, database: 'Shop', file: null },
      skip: 'The database provider is unknown',
    });
    expect(describe_('Nonsense')).toMatchObject({
      target: { provider: 'unknown', host: null },
      skip: 'The database provider is unknown',
    });
  });

  it('never returns a password, user or other value', () => {
    const values = [
      `Host=db;Username=alice;Password=${SECRET};Database=shop`,
      `Server=db;User Id=alice;Password="${SECRET};x";Initial Catalog=Shop`,
      `Data Source=app.db;Password=${SECRET}`,
      `postgres://alice:${SECRET}@db/shop?sslmode=require`,
      `Server=db;Pwd=${SECRET}`,
    ];
    for (const value of values) {
      for (const providers of [
        [],
        ['postgresql'],
        ['sqlserver'],
        ['sqlite'],
        ['mysql'],
      ] as DbProvider[][]) {
        const out = JSON.stringify(describe_(value, providers));
        expect(out).not.toContain(SECRET);
        expect(out).not.toContain('alice');
      }
    }
  });
});
