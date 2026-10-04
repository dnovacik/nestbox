import { ChevronDown, ChevronRight, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { Fragment, useState } from 'react';
import {
  type DepRow,
  type PackageResult,
  summarize,
  worstSeverity,
} from '@shared/tools/deps/contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { SEVERITY_TONE, sortRows, STEP_LABEL, TYPE_LABEL } from './labels';
import { useDepsActions, useDepsResults } from './use-deps';

const FILTERS = ['all', 'outdated', 'vulnerable'] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  outdated: 'Outdated',
  vulnerable: 'Vulnerable',
};

const packageLabel = (p: PackageResult) => (p.relPath === '' ? `${p.name} (root)` : p.relPath);

function Row({ row, pkg, projectId }: { row: DepRow; pkg: PackageResult; projectId: string }) {
  const [open, setOpen] = useState(false);
  const { copy } = useDepsActions(projectId);
  const worst = worstSeverity(row.advisories);
  return (
    <Fragment>
      <tr className="border-t border-line/60">
        <td className="py-1.5 pr-3 font-mono text-fg">{row.name}</td>
        <td className="pr-3 text-fg-faint">{row.type ? TYPE_LABEL[row.type] : 'transitive'}</td>
        <td className="pr-3 font-mono text-fg-muted">{row.range ?? ''}</td>
        <td className="pr-3 font-mono text-fg">
          {row.current ?? <span className="text-fg-faint">unknown</span>}
        </td>
        <td className="pr-3 font-mono text-fg-muted">{row.outdated ? (row.wanted ?? '') : ''}</td>
        <td className="pr-3 font-mono">
          {row.outdated && row.latest && (
            <span className={cn(row.major ? 'text-warn' : 'text-fg')}>
              {row.latest}
              {row.major && (
                <span className="ml-1.5 rounded border border-warn/40 px-1 text-[10px]">major</span>
              )}
            </span>
          )}
        </td>
        <td className="pr-3">
          {worst && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${row.advisories.length} ${row.advisories.length === 1 ? 'advisory' : 'advisories'} for ${row.name}`}
              onClick={() => setOpen((o) => !o)}
              className={cn(
                'inline-flex items-center gap-1 rounded border px-1.5 text-[10px]',
                SEVERITY_TONE[worst],
              )}
            >
              {open ? (
                <ChevronDown className="size-3" aria-hidden />
              ) : (
                <ChevronRight className="size-3" aria-hidden />
              )}
              {worst} · {row.advisories.length}
            </button>
          )}
        </td>
        <td className="text-right">
          {row.type !== null && (row.outdated || row.advisories.length > 0) && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Copy update command for ${row.name}`}
              onClick={() => copy.mutate({ relPath: pkg.relPath, name: row.name })}
            >
              <Copy className="size-3.5" aria-hidden />
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="pb-2 pl-4">
            <ul aria-label={`Advisories for ${row.name}`} className="space-y-1">
              {row.advisories.map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-[11px]">
                  <span
                    className={cn('rounded border px-1 text-[10px]', SEVERITY_TONE[a.severity])}
                  >
                    {a.severity}
                  </span>
                  <span className="text-fg">{a.title}</span>
                  {a.range && <span className="font-mono text-fg-faint">{a.range}</span>}
                  {a.url && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-brand hover:underline"
                      onClick={() => void api.app.openExternal(a.url ?? '')}
                    >
                      {a.id}
                      <ExternalLink className="size-3" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** Outdated and vulnerable dependencies, from the last check; Check runs the package manager (network). */
export default function DepsPanel({ projectId }: ToolPanelProps) {
  const { data, isError } = useDepsResults(projectId);
  const { check } = useDepsActions(projectId);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  if (isError) return <p className="text-sm text-fg-muted">Couldn't read the last check.</p>;
  if (!data) return <p className="text-sm text-fg-muted">Loading…</p>;

  const checking = data.checking || check.isPending;
  const pkg = data.packages.find((p) => p.projectId === selected) ?? data.packages[0] ?? null;
  const totals = summarize(data.packages);
  const needle = search.trim().toLowerCase();
  const rows = pkg
    ? sortRows(pkg.rows).filter(
        (r) =>
          (filter === 'all' || (filter === 'outdated' ? r.outdated : r.advisories.length > 0)) &&
          (needle === '' || r.name.toLowerCase().includes(needle)),
      )
    : [];

  return (
    <section
      aria-label="Dependencies"
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-fg">Dependencies</h2>
        {totals.checkedAt !== null && (
          <span className="text-xs text-fg-muted">
            {totals.outdated} outdated · {totals.vulnerable} vulnerable · checked{' '}
            {relativeTime(totals.checkedAt)}
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          disabled={checking}
          onClick={() => check.mutate()}
        >
          <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} aria-hidden />
          {checking ? 'Checking…' : 'Check'}
        </Button>
      </div>
      <p className="text-xs text-fg-faint">
        Check runs the package manager's own outdated and audit commands, which contact your
        registry. NestBox never changes package.json or the lockfile.
      </p>

      {data.packages.length === 0 ? (
        <p className="text-xs text-fg-muted">
          {checking
            ? 'Checking…'
            : 'Not checked yet. Check to see outdated and vulnerable dependencies.'}
        </p>
      ) : (
        <>
          {data.packages.length > 1 && (
            <div role="group" aria-label="Package" className="flex flex-wrap gap-1.5">
              {data.packages.map((p) => (
                <Button
                  key={p.projectId}
                  variant="secondary"
                  size="sm"
                  aria-pressed={p.projectId === pkg?.projectId}
                  className={cn(p.projectId === pkg?.projectId && 'border border-brand/50')}
                  onClick={() => setSelected(p.projectId)}
                >
                  {packageLabel(p)}
                </Button>
              ))}
            </div>
          )}
          {pkg && pkg.errors.length > 0 && (
            <p className="text-xs text-warn">
              {pkg.errors
                .map(
                  (e) =>
                    `${STEP_LABEL[e.step]} ${e.code === 'timeout' ? 'timed out' : "couldn't run (is the registry reachable?)"}`,
                )
                .join('. ')}
              .
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Show" className="flex gap-1">
              {FILTERS.map((f) => (
                <Button
                  key={f}
                  variant="ghost"
                  size="sm"
                  aria-pressed={filter === f}
                  className={cn(filter === f && 'bg-surface text-fg')}
                  onClick={() => setFilter(f)}
                >
                  {FILTER_LABEL[f]}
                </Button>
              ))}
            </div>
            <Input
              aria-label="Search dependencies"
              value={search}
              placeholder="Search by name"
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 w-56 text-xs"
            />
            {pkg && (
              <span className="ml-auto text-[11px] text-fg-faint">
                {pkg.manager === 'yarn-berry' ? 'yarn' : pkg.manager}
              </span>
            )}
          </div>
          {rows.length === 0 ? (
            <p className="text-xs text-fg-muted">Nothing to show.</p>
          ) : (
            <table aria-label="Dependency list" className="w-full text-left text-xs">
              <thead className="text-[10px] tracking-wider text-fg-muted uppercase">
                <tr>
                  <th className="pb-1 font-semibold">Package</th>
                  <th className="font-semibold">Type</th>
                  <th className="font-semibold">Range</th>
                  <th className="font-semibold">Installed</th>
                  <th className="font-semibold">Wanted</th>
                  <th className="font-semibold">Latest</th>
                  <th className="font-semibold">Advisories</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pkg &&
                  rows.map((r) => <Row key={r.name} row={r} pkg={pkg} projectId={projectId} />)}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
