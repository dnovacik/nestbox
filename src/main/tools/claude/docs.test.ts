import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeDocs, type ClaudeDoc } from './docs';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nestbox-claude-docs-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const docs = createClaudeDocs();

describe('claude docs', () => {
  it('reads a missing file as empty with no version, and creates it', async () => {
    expect(await docs.read(dir, 'CLAUDE.local.md')).toEqual({ text: '', version: null });
    const { version } = await docs.write(dir, 'CLAUDE.local.md', '# Local\n', null);
    expect(await docs.read(dir, 'CLAUDE.local.md')).toEqual({ text: '# Local\n', version });
  });

  it('refuses a stale version and a create over an existing file', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), '# A\n');
    const { version } = await docs.read(dir, 'CLAUDE.md');
    await docs.write(dir, 'CLAUDE.md', '# B\n', version);
    await expect(docs.write(dir, 'CLAUDE.md', '# C\n', version)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(docs.write(dir, 'CLAUDE.md', '# C\n', null)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# B\n');
  });

  it('keeps CRLF line endings', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), '# A\r\n\r\ntext\r\n');
    const { version } = await docs.read(dir, 'CLAUDE.md');
    await docs.write(dir, 'CLAUDE.md', '# A\n\nmore text\n', version);
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# A\r\n\r\nmore text\r\n');
  });

  it('keeps LF line endings', async () => {
    await writeFile(join(dir, 'CLAUDE.md'), '# A\n');
    const { version } = await docs.read(dir, 'CLAUDE.md');
    await docs.write(dir, 'CLAUDE.md', '# A\r\nB\r\n', version);
    expect(await readFile(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# A\nB\n');
  });

  it.each(['README.md', '../CLAUDE.md', '.env', 'sub/CLAUDE.md'])('refuses %j', async (name) => {
    await expect(docs.read(dir, name as ClaudeDoc)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(docs.write(dir, name as ClaudeDoc, 'x', null)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
