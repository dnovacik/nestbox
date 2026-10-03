import { describe, expect, it } from 'vitest';
import { parseCommit } from './commit';

const plain = [
  'tree 638a4385d16fa193f21a2afd264185491a5fd38e',
  'parent 11afd33fa5b2db6b9b538d0081c36bffbbe76dc6',
  'author Ada Lovelace <ada@example.com> 1791027609 +0200',
  'committer Ada Lovelace <ada@example.com> 1791027700 +0200',
  '',
  'feat: add the engine',
  '',
].join('\n');

describe('parseCommit', () => {
  it('reads the author name, time and subject (never the email)', () => {
    expect(parseCommit(plain)).toEqual({ subject: 'feat: add the engine', author: 'Ada Lovelace', at: 1_791_027_609_000 });
    expect(JSON.stringify(parseCommit(plain))).not.toContain('example.com');
  });

  it('skips a signature block and keeps only the first line of the message', () => {
    const signed = [
      'tree 638a',
      'author Ünï Tester <t@x> 1791027609 +0000',
      'committer Ünï Tester <t@x> 1791027609 +0000',
      'gpgsig -----BEGIN SSH SIGNATURE-----',
      ' U1NIU0lHAAAAAQAAADMAAAALc3NoLWVkMjU1MTkAAAAg',
      ' ',
      ' -----END SSH SIGNATURE-----',
      '',
      'subject line',
      '',
      'body',
    ].join('\n');
    expect(parseCommit(signed)).toEqual({ subject: 'subject line', author: 'Ünï Tester', at: 1_791_027_609_000 });
  });

  it('reads CRLF objects and an empty message', () => {
    expect(parseCommit('tree a\r\nauthor A B <a@b> 10 +0000\r\n\r\n')).toEqual({ subject: '', author: 'A B', at: 10_000 });
  });

  it('returns null without an author line', () => {
    expect(parseCommit('tree a\n\nmsg')).toBeNull();
    expect(parseCommit('')).toBeNull();
  });
});
