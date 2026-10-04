import { useState } from 'react';
import { type DepsOverview, summarize, worstSeverity } from '@shared/tools/deps/contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import { SEVERITY_TONE } from '@/tools/deps/labels';
import { useCheckAll, useDepsOverview } from './use-deps-overview';

const SCHEDULE_TEXT: Record<DepsOverview['schedule'], string> = {
  off: 'Scheduled checks are off (Settings).',
  daily: 'Checked daily in the background (Settings).',
  weekly: 'Checked weekly in the background (Settings).',
};

interface Usage {
  project: string;
  projectId: string;
  pkg: string;
  range: string | null;
  current: string | null;
  latest: string | null;
  outdated: boolean;
  severity: ReturnType<typeof worstSeverity>;
}

/** Which projects use a package, and at which versions (direct dependencies and vulnerable transitive ones). */
function usagesOf(overview: DepsOverview, name: string): Usage[] {
  return overview.projects.flatMap((project) =>
    project.packages.flatMap((pkg) =>
      pkg.rows
        .filter((r) => r.name === name)
        .map((r) => ({
          project: project.name,
          projectId: project.id,
          pkg: pkg.relPath === '' ? 'root' : pkg.relPath,
          range: r.range,
          current: r.current,
          latest: r.outdated ? r.latest : null,
          outdated: r.outdated,
          severity: worstSeverity(r.advisories),
        })),
    ),
  );
}

/** The machine-wide view of dependency health, built from every project's last check. */
export function DepsPage() {
  const { data, isError } = useDepsOverview();
  const checkAll = useCheckAll();
  const select = useUiStore((s) => s.select);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const [search, setSearch] = useState('');
  const open = (projectId: string) => {
    select(projectId);
    setActiveTab(projectId, 'deps');
  };

  if (isError)
    return <p className="p-6 text-sm text-fg-muted">Couldn't read the dependency results.</p>;
  if (!data) return <p className="p-6 text-sm text-fg-muted">Loading…</p>;

  const running = data.runningAll || data.projects.some((p) => p.checking);
  const projects = data.projects.map((p) => ({ ...p, totals: summarize(p.packages) }));
  const urgent = projects.filter((p) => p.totals.critical + p.totals.high > 0);
  const needle = search.trim().toLowerCase();
  const names =
    needle === ''
      ? []
      : [...new Set(projects.flatMap((p) => p.packages.flatMap((k) => k.rows.map((r) => r.name))))]
          .filter((n) => n.toLowerCase().includes(needle))
          .sort()
          .slice(0, 20);

  return (
    <section
      aria-label="Dependencies"
      className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-base font-semibold text-fg">Dependencies</h1>
        <span className="text-xs text-fg-muted">{SCHEDULE_TEXT[data.schedule]}</span>
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          disabled={running || checkAll.isPending}
          onClick={() => checkAll.mutate()}
        >
          {running ? 'Checking…' : 'Check all now'}
        </Button>
      </div>
      <p className="text-xs text-fg-faint">
        Results come from each project's last check. Checks run the package managers' outdated and
        audit commands, which contact your registries.
      </p>

      <section
        aria-label="High or critical advisories"
        className="rounded-lg border border-line bg-card p-4"
      >
        <h2 className="mb-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
          High or critical advisories
        </h2>
        {urgent.length === 0 ? (
          <p className="text-xs text-fg-muted">None in the projects checked so far.</p>
        ) : (
          <ul className="space-y-1">
            {urgent.map((p) => (
              <li key={p.id} className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  className="font-medium text-fg hover:text-brand"
                  onClick={() => open(p.id)}
                >
                  {p.name}
                </button>
                {p.totals.critical > 0 && (
                  <span className={cn('rounded border px-1 text-[10px]', SEVERITY_TONE.critical)}>
                    {p.totals.critical} critical
                  </span>
                )}
                {p.totals.high > 0 && (
                  <span className={cn('rounded border px-1 text-[10px]', SEVERITY_TONE.high)}>
                    {p.totals.high} high
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Find a package" className="rounded-lg border border-line bg-card p-4">
        <h2 className="mb-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
          Find a package
        </h2>
        <Input
          aria-label="Package name"
          value={search}
          placeholder="e.g. react"
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-72 text-sm"
        />
        {needle !== '' && names.length === 0 && (
          <p className="mt-2 text-xs text-fg-muted">No checked project uses it.</p>
        )}
        {names.map((name) => (
          <div key={name} className="mt-3">
            <h3 className="font-mono text-xs text-fg">{name}</h3>
            <table aria-label={`Projects using ${name}`} className="mt-1 w-full text-left text-xs">
              <tbody>
                {usagesOf(data, name).map((u) => (
                  <tr key={`${u.projectId}/${u.pkg}`} className="border-t border-line/60">
                    <td className="py-1 pr-3">
                      <button
                        type="button"
                        className="text-fg hover:text-brand"
                        onClick={() => open(u.projectId)}
                      >
                        {u.project}
                      </button>
                    </td>
                    <td className="pr-3 text-fg-faint">{u.pkg}</td>
                    <td className="pr-3 font-mono text-fg-muted">{u.range ?? 'transitive'}</td>
                    <td className="pr-3 font-mono text-fg">{u.current ?? 'unknown'}</td>
                    <td className="pr-3 font-mono text-warn">{u.latest ? `→ ${u.latest}` : ''}</td>
                    <td>
                      {u.severity && (
                        <span
                          className={cn(
                            'rounded border px-1 text-[10px]',
                            SEVERITY_TONE[u.severity],
                          )}
                        >
                          {u.severity}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>

      <section aria-label="Projects" className="rounded-lg border border-line bg-card p-4">
        <h2 className="mb-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
          Projects
        </h2>
        <ul className="space-y-1">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3 text-xs">
              <button
                type="button"
                className="w-48 truncate text-left text-fg hover:text-brand"
                onClick={() => open(p.id)}
              >
                {p.name}
              </button>
              {p.checking ? (
                <span className="text-fg-muted">Checking…</span>
              ) : p.totals.checkedAt === null ? (
                <span className="text-fg-faint">Not checked yet</span>
              ) : (
                <span className="text-fg-muted">
                  {p.totals.outdated} outdated · {p.totals.vulnerable} vulnerable · checked{' '}
                  {relativeTime(p.totals.checkedAt)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
