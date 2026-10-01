import { useNavigateSubscription } from '@/lib/navigate';
import { useProcessesChangedSubscription, useProjects, useProjectsChangedSubscription } from '@/lib/queries';
import { useUiStore } from '@/state/ui-store';
import { EmptyState } from './EmptyState';
import { findProjectNode } from './find-project';
import { ProjectView } from './ProjectView';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

export function App() {
  useProjectsChangedSubscription();
  useProcessesChangedSubscription();
  useNavigateSubscription();
  const { data: projects = [], isPending } = useProjects();
  const selectedId = useUiStore((s) => s.selectedProjectId);
  const node = findProjectNode(projects, selectedId) ?? findProjectNode(projects, projects[0]?.id ?? null);

  return (
    <div className="flex h-full flex-col bg-app text-fg">
      <TitleBar node={node} />
      <div className="flex min-h-0 flex-1">
        <Sidebar projects={projects} selectedId={node?.detected.id ?? null} />
        <main className="flex min-w-0 flex-1 flex-col">
          {isPending ? null : node ? <ProjectView key={node.detected.id} node={node} /> : <EmptyState />}
        </main>
      </div>
      <StatusBar projectCount={projects.length} />
    </div>
  );
}
