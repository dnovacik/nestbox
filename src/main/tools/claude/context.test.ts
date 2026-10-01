import { describe, expect, it } from 'vitest';
import { applyBlock, buildBlock, CONTEXT_END, CONTEXT_START, type ContextFacts } from './context';

const facts: ContextFacts = {
  packageManager: 'pnpm',
  scripts: [
    { name: 'dev', command: 'vite' },
    { name: 'echo', command: 'echo `date`' },
  ],
  runGroups: [{ name: 'all', scripts: ['dev', 'api'] }],
  workspaces: [{ name: '@shop/api', relPath: 'packages/api' }],
  prismaSchema: 'prisma/schema.prisma',
  dockerCompose: 'docker-compose.yml',
  port: 3000,
  envKeys: ['DATABASE_URL', 'PORT'],
};

describe('buildBlock', () => {
  it('renders what NestBox knows between markers', () => {
    const block = buildBlock(facts);
    expect(block.startsWith(`${CONTEXT_START}\n## Project context\n`)).toBe(true);
    expect(block.endsWith(`\n${CONTEXT_END}`)).toBe(true);
    expect(block).toContain('- Package manager: pnpm');
    expect(block).toContain('- Dev server port (PORT): 3000');
    expect(block).toContain('- `dev`: `vite`');
    expect(block).toContain('- `echo`: `` echo `date` ``');
    expect(block).toContain('- all: `dev`, `api`');
    expect(block).toContain('- `packages/api` (@shop/api)');
    expect(block).toContain('- Prisma schema: `prisma/schema.prisma`');
    expect(block).toContain('Keys from `.env.example`: `DATABASE_URL`, `PORT`');
    expect(block).not.toMatch(/\n\n\n/);
  });

  it('is deterministic and leaves out empty sections', () => {
    const bare: ContextFacts = { ...facts, scripts: [], runGroups: [], workspaces: [], envKeys: [], prismaSchema: null, dockerCompose: null, port: null, packageManager: null };
    expect(buildBlock(bare)).toBe(buildBlock(bare));
    expect(buildBlock(bare)).not.toContain('###');
    expect(buildBlock(bare)).not.toMatch(/\n\n\n/);
  });
});

describe('applyBlock', () => {
  const block = `${CONTEXT_START}\nnew\n${CONTEXT_END}`;

  it('replaces only the text between the markers', () => {
    const existing = `# Shop\n\nHand-written.\n\n${CONTEXT_START}\nold\n${CONTEXT_END}\n\n## Notes\nKeep me.\n`;
    expect(applyBlock(existing, block)).toBe(`# Shop\n\nHand-written.\n\n${block}\n\n## Notes\nKeep me.\n`);
  });

  it('appends after one blank line without markers', () => {
    expect(applyBlock('# Shop\n\n\n', block)).toBe(`# Shop\n\n${block}\n`);
    expect(applyBlock('# Shop', block)).toBe(`# Shop\n\n${block}\n`);
  });

  it('fills an empty file', () => {
    expect(applyBlock('', block)).toBe(`${block}\n`);
  });

  it('appends when only the start marker is there', () => {
    expect(applyBlock(`# Shop\n${CONTEXT_START}\n`, block)).toBe(`# Shop\n${CONTEXT_START}\n\n${block}\n`);
  });

  it('keeps CRLF', () => {
    const existing = `# Shop\r\n\r\n${CONTEXT_START}\r\nold\r\n${CONTEXT_END}\r\n`;
    expect(applyBlock(existing, block)).toBe(`# Shop\r\n\r\n${CONTEXT_START}\r\nnew\r\n${CONTEXT_END}\r\n`);
    expect(applyBlock('# Shop\r\n', block)).toBe(`# Shop\r\n\r\n${CONTEXT_START}\r\nnew\r\n${CONTEXT_END}\r\n`);
  });

  it('is stable when applied twice', () => {
    const once = applyBlock('# Shop\n', buildBlock(facts));
    expect(applyBlock(once, buildBlock(facts))).toBe(once);
  });
});
