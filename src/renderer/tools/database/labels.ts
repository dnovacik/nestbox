import type { DbStatus, DbTargetView } from '@shared/tools/database/contract';

type Reach = NonNullable<DbStatus['reach']>;

/** "postgresql · localhost:5432/shop" or "SQLite · dev.db": never more than the main side sent. */
export function targetLabel(target: DbTargetView): string {
  if (target.provider === 'sqlite') return `SQLite · ${target.database ?? 'file'}`;
  const address = [target.host, target.port === null ? null : `:${target.port}`].filter(Boolean).join('');
  const where = `${address}${target.database ? `/${target.database}` : ''}`;
  return where ? `${target.provider} · ${where}` : target.provider;
}

export const REACH_LABELS: Record<Reach['result'], { text: string; tone: 'ok' | 'err' | 'warn' | 'muted' }> = {
  reachable: { text: 'Reachable', tone: 'ok' },
  refused: { text: 'Refused', tone: 'err' },
  timeout: { text: 'No answer', tone: 'err' },
  dns: { text: 'Host not found', tone: 'err' },
  'missing-file': { text: 'File missing', tone: 'warn' },
  'not-checked': { text: 'Not checked', tone: 'muted' },
};

export const TONE_TEXT = { ok: 'text-ok', err: 'text-err', warn: 'text-warn', muted: 'text-fg-muted' } as const;
export const TONE_DOT = { ok: 'bg-ok', err: 'bg-err', warn: 'bg-warn', muted: 'bg-idle' } as const;

/** The line shown when there is no URL to describe; null when there is one. */
export function urlProblem(status: DbStatus): string | null {
  switch (status.url.state) {
    case 'missing':
      return status.url.configTs
        ? `No ${status.variable} in .env. prisma.config.ts may set it; NestBox doesn't run that file.`
        : `No ${status.variable} in .env or prisma/.env.`;
    case 'literal':
      return "The URL is written in the schema itself; NestBox doesn't read it.";
    case 'set':
      return null;
  }
}
