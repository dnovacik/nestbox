import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeUrl } from './url';

const SCHEMA_DIR = join('/p', 'prisma');

describe('describeUrl', () => {
  it.each([
    ['postgresql://u:s3cr3t@localhost:5432/shop?schema=public', { provider: 'postgresql', host: 'localhost', port: 5432, database: 'shop' }],
    ['postgres://u:s3cr3t@db.internal/shop', { provider: 'postgresql', host: 'db.internal', port: 5432, database: 'shop' }],
    ['mysql://root:s3cr3t@127.0.0.1:3307/app', { provider: 'mysql', host: '127.0.0.1', port: 3307, database: 'app' }],
    ['mariadb://root:s3cr3t@127.0.0.1/app', { provider: 'mysql', host: '127.0.0.1', port: 3306, database: 'app' }],
    ['mongodb://u:s3cr3t@localhost/app?authSource=admin', { provider: 'mongodb', host: 'localhost', port: 27017, database: 'app' }],
    ['mongodb+srv://u:s3cr3t@cluster0.example.net/app', { provider: 'mongodb', host: 'cluster0.example.net', port: null, database: 'app' }],
    ['postgresql://u:s3cr3t@[::1]:6543/shop', { provider: 'postgresql', host: '::1', port: 6543, database: 'shop' }],
    ['cockroachdb://u:s3cr3t@localhost/bank', { provider: 'cockroachdb', host: 'localhost', port: 26257, database: 'bank' }],
    ['postgresql://u:p%40ss%3As3cr3t@localhost/shop', { provider: 'postgresql', host: 'localhost', port: 5432, database: 'shop' }],
    ['sqlserver://localhost:1434;database=app;user=sa;password=s3cr3t;encrypt=true', { provider: 'sqlserver', host: 'localhost', port: 1434, database: 'app' }],
    ['sqlserver://localhost;initial catalog=app;password=s3cr3t', { provider: 'sqlserver', host: 'localhost', port: 1433, database: 'app' }],
    ['prisma+postgres://accelerate.prisma-data.net/?api_key=s3cr3t', { provider: 'accelerate', host: 'accelerate.prisma-data.net', port: null, database: null }],
    ['prisma://accelerate.prisma-data.net/?api_key=s3cr3t', { provider: 'accelerate', host: 'accelerate.prisma-data.net', port: null, database: null }],
  ])('%s', (raw, expected) => {
    expect(describeUrl(raw, SCHEMA_DIR)).toEqual({ ...expected, file: null });
  });

  it('resolves a SQLite file relative to the schema folder', () => {
    expect(describeUrl('file:./dev.db', SCHEMA_DIR)).toEqual({ provider: 'sqlite', host: null, port: null, database: 'dev.db', file: resolve('/p', 'prisma', 'dev.db') });
    expect(describeUrl('file:/data/app.db?connection_limit=1', SCHEMA_DIR)).toMatchObject({ provider: 'sqlite', file: resolve('/data', 'app.db') });
  });

  it('describes anything else as unknown', () => {
    for (const raw of ['', 'not a url', 'redis://u:s3cr3t@localhost:6379', 'postgresql://']) {
      expect(describeUrl(raw, SCHEMA_DIR)).toMatchObject({ provider: 'unknown', host: null, port: null, database: null });
    }
  });

  it('never returns the user, the password or a query parameter', () => {
    const urls = [
      'postgresql://alice:s3cr3t@localhost:5432/shop?sslpassword=s3cr3t',
      'mysql://alice:s3cr3t@localhost/app',
      'sqlserver://localhost;database=app;user=alice;password=s3cr3t',
      'mongodb+srv://alice:s3cr3t@cluster0.example.net/app?retryWrites=true',
      'prisma://accelerate.prisma-data.net/?api_key=s3cr3t',
      'redis://alice:s3cr3t@localhost',
      'file:./dev.db?password=s3cr3t',
      '::s3cr3t@@',
    ];
    for (const raw of urls) {
      const out = JSON.stringify(describeUrl(raw, SCHEMA_DIR));
      expect(out).not.toContain('s3cr3t');
      expect(out).not.toContain('alice');
    }
  });
});
