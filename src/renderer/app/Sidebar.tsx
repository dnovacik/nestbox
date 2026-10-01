import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { aggregateState, belongsTo, type AggregateState } from '@shared/processes';
import { StateDot } from '@/components/StateDot';
import { useAddProject, useProcesses } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { DetectedProject, ProjectSummary } from '@shared/detected';
import { filterProjects } from './find-project';

interface SidebarProps {
  projects: ProjectSummary[];
  selectedId: string | null;
}

export function Sidebar({ projects, selectedId }: SidebarProps) {
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);
  const addProject = useAddProject();
  const visible = filterProjects(projects, filter);
  const pinned = visible.filter((p) => p.pinned);
  const others = visible.filter((p) => !p.pinned);

  return (
    <aside aria-label="Projects" className="flex w-64 shrink-0 flex-col border-r border-line bg-card">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-fg-muted" />
          <Input
            aria-label="Filter projects"
            placeholder="Filter projects…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 bg-app pl-8 text-xs"
          />
        </div>
        {pinned.length > 0 && (
          <ProjectSection title="Pinned" count={pinned.length} projects={pinned} selectedId={selectedId} />
        )}
        <ProjectSection title="All projects" count={projects.length} projects={others} selectedId={selectedId} />
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

function ProjectSection({ title, count, projects, selectedId }: SidebarProps & { title: string; count: number }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1.5 flex items-center justify-between px-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
        <span>{title}</span>
        <span className="text-fg-faint">{count}</span>
      </h2>
      <ul className="space-y-0.5">
        {projects.map((project) => (
          <ProjectItem key={project.id} project={project} selectedId={selectedId} />
        ))}
      </ul>
    </section>
  );
}

function ProjectItem({ project, selectedId }: { project: ProjectSummary; selectedId: string | null }) {
  const collapsed = useUiStore((s) => s.collapsed[project.id] ?? false);
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed);
  const workspaces = project.detected.workspaces;
  const { data: processes = [] } = useProcesses();
  const stateOf = (projectId: string, withWorkspaces: boolean): AggregateState =>
    aggregateState(
      processes
        .filter((p) => (withWorkspaces ? belongsTo(p.projectId, projectId) : p.projectId === projectId))
        .map((p) => p.state),
    );
  return (
    <li>
      <div className="flex items-center">
        <ProjectRow
          detected={project.detected}
          label={project.name}
          selected={selectedId === project.id}
          state={stateOf(project.id, collapsed)}
        />
        {workspaces.length > 0 && (
          <button
            type="button"
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${project.name}`}
            aria-expanded={!collapsed}
            onClick={() => toggleCollapsed(project.id)}
            className="rounded p-1 text-fg-faint hover:text-fg"
          >
            {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        )}
      </div>
      {workspaces.length > 0 && !collapsed && (
        <ul className="mt-0.5 ml-4 space-y-0.5 border-l border-line pl-2">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <ProjectRow detected={ws} label={ws.name} selected={selectedId === ws.id} state={stateOf(ws.id, false)} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

interface ProjectRowProps {
  detected: DetectedProject;
  label: string;
  selected: boolean;
  state: AggregateState;
}

function ProjectRow({ detected, label, selected, state }: ProjectRowProps) {
  const select = useUiStore((s) => s.select);
  return (
    <button
      type="button"
      aria-current={selected ? 'page' : undefined}
      title={state === 'idle' ? undefined : `${label}: ${state}`}
      onClick={() => select(detected.id)}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
        selected ? 'border-line bg-surface text-fg' : 'border-transparent text-fg-muted hover:bg-surface/50 hover:text-fg',
        detected.missing && 'opacity-60',
      )}
    >
      <StateDot state={state} />
      <span className="truncate">{label}</span>
      {detected.missing && <span className="ml-auto text-[10px] text-err">missing</span>}
    </button>
  );
}
