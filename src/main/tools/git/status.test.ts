import { describe, expect, it } from 'vitest';
import { MAX_FILES, parseStatus } from './status';

const OID = '28d8048f9696af1c9a052045485e4e8ce489d31f';
const H = '7898192613b2afb6025042ff6bd878ac1994e85';
const z = (...records: string[]) => records.map((r) => `${r}\0`).join('');
const head = (branch = 'main', extra: string[] = []) => [`# branch.oid ${OID}`, `# branch.head ${branch}`, ...extra];
const one = (xy: string, path: string) => `1 ${xy} N... 100644 100644 100644 ${H} ${H} ${path}`;

describe('parseStatus', () => {
  it('reads a clean branch with an upstream', () => {
    const s = parseStatus(z(...head('main', ['# branch.upstream origin/main', '# branch.ab +2 -1'])), false);
    expect(s).toMatchObject({ oid: OID, branch: 'main', detachedAt: null, upstream: 'origin/main', ahead: 2, behind: 1 });
    expect(s.changes).toEqual({ total: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, truncated: false });
    expect(s.files).toEqual([]);
  });

  it('has no ahead/behind without an upstream', () => {
    expect(parseStatus(z(...head()), false)).toMatchObject({ upstream: null, ahead: null, behind: null });
  });

  it('reads an upstream that is gone (no ab line)', () => {
    expect(parseStatus(z(...head('main', ['# branch.upstream origin/gone'])), false)).toMatchObject({
      upstream: 'origin/gone',
      ahead: null,
      behind: null,
    });
  });

  it('reports a detached HEAD by its short hash', () => {
    expect(parseStatus(z(...head('(detached)')), false)).toMatchObject({ branch: null, detachedAt: '28d8048' });
  });

  it('reports a branch with no commits yet', () => {
    const s = parseStatus(z('# branch.oid (initial)', '# branch.head main', '? a.txt'), false);
    expect(s).toMatchObject({ oid: null, branch: 'main', detachedAt: null });
    expect(s.changes.untracked).toBe(1);
  });

  it('counts staged, unstaged, untracked and conflicted changes, each path once', () => {
    const s = parseStatus(
      z(
        ...head(),
        one('.M', 'a.txt'),
        one('MM', 'both.ts'),
        one('A.', 'new.ts'),
        `u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} conflict.ts`,
        '? notes.md',
      ),
      false,
    );
    expect(s.changes).toEqual({ total: 5, staged: 2, unstaged: 2, untracked: 1, conflicted: 1, truncated: false });
  });

  it('lists a file changed in both the index and the tree in both groups', () => {
    const s = parseStatus(z(...head(), one('MM', 'both.ts')), false);
    expect(s.files).toEqual([
      { path: 'both.ts', origPath: null, group: 'staged', status: 'M', exists: true },
      { path: 'both.ts', origPath: null, group: 'changes', status: 'M', exists: true },
    ]);
  });

  it('reads a rename with its original path, and paths with spaces and unicode', () => {
    const s = parseStatus(z(...head(), `2 R. N... 100644 100644 100644 ${H} ${H} R100 d é.txt`, 'b c.txt', '? new file.txt'), false);
    expect(s.files).toEqual([
      { path: 'd é.txt', origPath: 'b c.txt', group: 'staged', status: 'R', exists: true },
      { path: 'new file.txt', origPath: null, group: 'untracked', status: '?', exists: true },
    ]);
    expect(s.changes.total).toBe(2);
  });

  it('marks deleted files as missing', () => {
    const s = parseStatus(z(...head(), one('D.', 'gone.ts'), one('.D', 'removed.ts')), false);
    expect(s.files.map((f) => [f.path, f.group, f.status, f.exists])).toEqual([
      ['gone.ts', 'staged', 'D', false],
      ['removed.ts', 'changes', 'D', false],
    ]);
  });

  it('puts unmerged files under conflicts', () => {
    const s = parseStatus(z(...head(), `u AA N... 100644 100644 100644 100644 ${H} ${H} ${H} both added.ts`), false);
    expect(s.files).toEqual([{ path: 'both added.ts', origPath: null, group: 'conflicts', status: 'U', exists: true }]);
  });

  it('ignores ignored-file records', () => {
    expect(parseStatus(z(...head(), '! dist/'), false).changes.total).toBe(0);
  });

  it('drops the cut record of truncated output and says so', () => {
    const full = z(...head(), one('.M', 'a.txt'), '? b.txt');
    const s = parseStatus(full.slice(0, full.length - 4), true);
    expect(s.files.map((f) => f.path)).toEqual(['a.txt']);
    expect(s.changes).toMatchObject({ total: 1, truncated: true });
  });

  it('drops a rename whose original path was cut off', () => {
    const full = z(...head(), `2 R. N... 100644 100644 100644 ${H} ${H} R100 new.ts`);
    expect(parseStatus(`${full}ol`, true).files).toEqual([]);
  });

  it(`lists at most ${MAX_FILES} files but counts them all`, () => {
    const records = Array.from({ length: MAX_FILES + 20 }, (_, i) => `? f${i}.txt`);
    const s = parseStatus(z(...head(), ...records), false);
    expect(s.files).toHaveLength(MAX_FILES);
    expect(s.changes.untracked).toBe(MAX_FILES + 20);
  });
});
