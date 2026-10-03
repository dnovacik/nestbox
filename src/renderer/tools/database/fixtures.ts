import type { DbStatus } from '@shared/tools/database/contract';

/** A reachable Postgres from .env with a Prisma schema, for renderer tests. */
export function dbStatus(patch: Partial<DbStatus> = {}): DbStatus {
  return {
    prisma: { schema: 'prisma/schema.prisma' },
    variable: 'DATABASE_URL',
    url: { state: 'set', target: { provider: 'postgresql', host: 'localhost', port: 5432, database: 'shop', file: null, source: '.env' } },
    reach: { result: 'reachable', reason: null },
    running: { command: null, studio: null },
    ...patch,
  };
}
