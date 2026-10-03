// Running the project's own Prisma CLI. --no-install keeps npx and bunx from downloading Prisma into a
// project that doesn't have it. Prisma's error text can name the database user, so only its P-code is shown.
import type { PackageManager } from '@shared/detected';

export function prismaCommand(pm: PackageManager | null, args: readonly string[]): { command: string; args: string[] } {
  switch (pm) {
    case 'pnpm':
      return { command: 'pnpm', args: ['exec', 'prisma', ...args] };
    case 'yarn':
      return { command: 'yarn', args: ['prisma', ...args] };
    case 'bun':
      return { command: 'bunx', args: ['--no-install', 'prisma', ...args] };
    default:
      return { command: 'npx', args: ['--no-install', 'prisma', ...args] };
  }
}

export function firstPrismaCode(output: string): string | null {
  return /\bP\d{4}\b/.exec(output)?.[0] ?? null;
}

const LOGIN_MESSAGES: Record<string, string> = {
  P1000: 'Wrong user or password',
  P1001: "Can't reach the database server",
  P1003: "The database doesn't exist",
  P1010: 'The user has no access to this database',
  P1012: 'The Prisma schema has an error',
};

export function loginMessage(code: string | null): string {
  if (code === null) return 'Failed';
  return LOGIN_MESSAGES[code] ?? `Failed (${code})`;
}
