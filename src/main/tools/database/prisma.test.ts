import { describe, expect, it } from 'vitest';
import { firstPrismaCode, loginMessage, prismaCommand } from './prisma';

describe('prismaCommand', () => {
  it.each([
    ['pnpm', { command: 'pnpm', args: ['exec', 'prisma', 'generate'] }],
    ['npm', { command: 'npx', args: ['--no-install', 'prisma', 'generate'] }],
    [null, { command: 'npx', args: ['--no-install', 'prisma', 'generate'] }],
    ['yarn', { command: 'yarn', args: ['prisma', 'generate'] }],
    ['bun', { command: 'bunx', args: ['--no-install', 'prisma', 'generate'] }],
  ] as const)('%s', (pm, expected) => {
    expect(prismaCommand(pm, ['generate'])).toEqual(expected);
  });

  it('builds one line for a terminal', () => {
    const { command, args } = prismaCommand('pnpm', ['migrate', 'dev']);
    expect([command, ...args].join(' ')).toBe('pnpm exec prisma migrate dev');
  });
});

describe('firstPrismaCode and loginMessage', () => {
  it('finds the first error code in the output', () => {
    expect(firstPrismaCode('Error: P1000: Authentication failed against database server at `localhost`\n')).toBe('P1000');
    expect(firstPrismaCode('Error: P1001\nP1003')).toBe('P1001');
    expect(firstPrismaCode('no code here')).toBeNull();
  });

  it.each([
    ['P1000', 'Wrong user or password'],
    ['P1001', "Can't reach the database server"],
    ['P1003', "The database doesn't exist"],
    ['P1010', 'The user has no access to this database'],
    ['P1012', 'The Prisma schema has an error'],
    ['P2010', 'Failed (P2010)'],
    [null, 'Failed'],
  ])('%s', (code, message) => {
    expect(loginMessage(code)).toBe(message);
  });
});
