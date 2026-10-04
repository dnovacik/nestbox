import type { DepRow, Severity } from '@shared/tools/deps/contract';
import { worstSeverity } from '@shared/tools/deps/contract';

/** Badge classes per severity (tokens only). */
export const SEVERITY_TONE: Record<Severity, string> = {
  critical: 'border-err/60 bg-err/15 text-err',
  high: 'border-err/40 text-err',
  moderate: 'border-warn/40 text-warn',
  low: 'border-line text-fg-muted',
  info: 'border-line text-fg-faint',
};

const RANK: Record<Severity, number> = { critical: 5, high: 4, moderate: 3, low: 2, info: 1 };

/** Vulnerable first (worst severity first), then major updates, then other updates, then the rest; by name within. */
export function sortRows(rows: readonly DepRow[]): DepRow[] {
  const score = (r: DepRow) => {
    const worst = worstSeverity(r.advisories);
    return (worst ? RANK[worst] * 100 : 0) + (r.outdated ? (r.major ? 20 : 10) : 0);
  };
  return [...rows].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
}

export const TYPE_LABEL: Record<NonNullable<DepRow['type']>, string> = {
  prod: 'dep',
  dev: 'dev',
  optional: 'optional',
  peer: 'peer',
};

export const STEP_LABEL = { outdated: 'Outdated check', audit: 'Audit' } as const;
