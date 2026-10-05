import { Package, Plug, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePorts } from '@/lib/ports';
import { useAddProject, useSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { ProjectSummary } from '@shared/detected';
import { filterProjects } from './find-project';
import { ProjectTree } from './ProjectTree';
import { summarize } from '@shared/tools/deps/contract';
import { isToolEnabled } from '@shared/tools';
import { useDepsOverview } from '@/deps/use-deps-overview';

interface SidebarProps {
  projects: ProjectSummary[];
  selectedId: string | null;
}

export function Sidebar({ projects, selectedId }: SidebarProps) {
  const { data: settings } = useSettings();
  const depsOn = isToolEnabled(settings?.disabledTools ?? [], 'deps');
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);
  const addProject = useAddProject();
  const visible = filterProjects(projects, filter);
  const filtering = filter.trim() !== '';

  return (
    <aside
      aria-label="Projects"
      className="flex w-64 shrink-0 flex-col border-r border-line bg-card"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-fg-muted"
          />
          <Input
            aria-label="Filter projects"
            placeholder="Filter projects…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 bg-app pl-8 text-xs"
          />
        </div>
        <PortsEntry />
        {depsOn && <DepsEntry />}
        <ProjectTree
          projects={visible}
          total={projects.length}
          selectedId={selectedId}
          filtering={filtering}
        />
        {filtering && visible.length === 0 && (
          <div className="space-y-2 px-2 text-xs text-fg-muted">
            <p>No projects match “{filter.trim()}”.</p>
            <Button variant="ghost" size="sm" onClick={() => setFilter('')}>
              Clear filter
            </Button>
          </div>
        )}
      </div>
      <div className="border-t border-line p-3">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={addProject.isPending}
          onClick={() => addProject.mutate()}
        >
          <Plus className="size-3.5 text-brand" />
          Add project
        </Button>
      </div>
    </aside>
  );
}

/** Opens the machine-wide Ports page. The count uses the last scan only: the sidebar never polls. */
function PortsEntry() {
  const view = useUiStore((s) => s.view);
  const showPorts = useUiStore((s) => s.showPorts);
  const { data } = usePorts(false);
  const owned = data?.rows.filter((r) => r.owner !== null).length ?? 0;
  const active = view === 'ports';
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={showPorts}
      className={cn(
        'flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
        active
          ? 'border-line bg-surface text-fg'
          : 'border-transparent text-fg-muted hover:bg-surface/50 hover:text-fg',
      )}
    >
      <Plug aria-hidden className="size-3.5 text-brand" />
      <span>Ports</span>
      {owned > 0 && (
        <span aria-hidden className="ml-auto font-mono text-[10px] text-fg-faint">
          {owned}
        </span>
      )}
    </button>
  );
}

/** Opens the Dependencies page; the count is projects with high or critical advisories (last results, no polling). */
function DepsEntry() {
  const view = useUiStore((s) => s.view);
  const showDeps = useUiStore((s) => s.showDeps);
  const { data } = useDepsOverview(false);
  const urgent =
    data?.projects.filter((p) => {
      const t = summarize(p.packages);
      return t.critical + t.high > 0;
    }).length ?? 0;
  const active = view === 'deps';
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={showDeps}
      className={cn(
        'flex items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
        active
          ? 'border-line bg-surface text-fg'
          : 'border-transparent text-fg-muted hover:bg-surface/50 hover:text-fg',
      )}
    >
      <Package aria-hidden className="size-3.5 text-brand" />
      <span>Dependencies</span>
      {urgent > 0 && (
        <span
          aria-label={`${urgent} with high or critical advisories`}
          className="ml-auto font-mono text-[10px] text-err"
        >
          {urgent}
        </span>
      )}
    </button>
  );
}
