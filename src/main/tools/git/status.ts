// Parses `git status --porcelain=v2 --branch -z`. File names are shown in the UI only, never logged.
import { type GitChanges, type GitFile, MAX_GIT_FILES } from '@shared/tools/git/contract';

export const MAX_FILES = MAX_GIT_FILES;

export interface ParsedStatus {
  /** HEAD's full hash; null on a branch with no commits yet. */
  oid: string | null;
  branch: string | null;
  detachedAt: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  changes: GitChanges;
  files: GitFile[];
}

/** Fields before the path in each record type ('2' is followed by a NUL and the original path). */
const FIELDS_BEFORE_PATH: Record<string, number> = { '1': 8, '2': 9, u: 10 };

/** The text after the nth space: paths may contain spaces, the fixed fields never do. */
function afterFields(record: string, n: number): string | null {
  let at = -1;
  for (let i = 0; i < n; i++) {
    at = record.indexOf(' ', at + 1);
    if (at === -1) return null;
  }
  return record.slice(at + 1);
}

/** truncated: the output hit its size cap, so its last record may be cut off. */
export function parseStatus(stdout: string, truncated: boolean): ParsedStatus {
  const tokens = stdout.split('\0');
  // Every complete record ends with a NUL, so the text after the last one is empty or cut off.
  tokens.pop();

  const result: ParsedStatus = {
    oid: null,
    branch: null,
    detachedAt: null,
    upstream: null,
    ahead: null,
    behind: null,
    changes: { total: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, truncated },
    files: [],
  };
  let head: string | null = null;
  const files: GitFile[] = [];
  const add = (file: GitFile) => {
    if (files.length < MAX_FILES) files.push(file);
  };

  for (let i = 0; i < tokens.length; i++) {
    const record = tokens[i] ?? '';
    if (record.startsWith('# ')) {
      const [, key, ...rest] = record.split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') result.oid = value === '(initial)' ? null : value;
      else if (key === 'branch.head') head = value;
      else if (key === 'branch.upstream') result.upstream = value;
      else if (key === 'branch.ab') {
        const ab = /^\+(\d+) -(\d+)$/.exec(value);
        if (ab) [result.ahead, result.behind] = [Number(ab[1]), Number(ab[2])];
      }
      continue;
    }
    const type = record[0] ?? '';
    if (type === '?') {
      result.changes.total++;
      result.changes.untracked++;
      add({ path: record.slice(2), origPath: null, group: 'untracked', status: '?', exists: true });
      continue;
    }
    const fields = FIELDS_BEFORE_PATH[type];
    if (fields === undefined) continue; // '!' (ignored) or something newer than we know
    const path = afterFields(record, fields);
    if (path === null) continue;
    let origPath: string | null = null;
    if (type === '2') {
      // The original path is the next token; when the cap cut it off, the rename is incomplete.
      if (i + 1 >= tokens.length) break;
      origPath = tokens[++i] ?? null;
    }
    const x = record[2] ?? '.';
    const y = record[3] ?? '.';
    result.changes.total++;
    if (type === 'u') {
      result.changes.conflicted++;
      add({ path, origPath, group: 'conflicts', status: 'U', exists: true });
      continue;
    }
    const exists = x !== 'D' && y !== 'D';
    if (x !== '.') {
      result.changes.staged++;
      add({ path, origPath, group: 'staged', status: x, exists });
    }
    if (y !== '.') {
      result.changes.unstaged++;
      add({ path, origPath: null, group: 'changes', status: y, exists });
    }
  }

  if (head === '(detached)') result.detachedAt = result.oid?.slice(0, 7) ?? null;
  else result.branch = head;
  result.files = files;
  return result;
}
