import { useNavigateSubscription } from '@/lib/navigate';
import { useEffect } from 'react';
import { isToolEnabled } from '@shared/tools';
import { useProcessesChangedSubscription, useProjects, useProjectsChangedSubscription, useSettings } from '@/lib/queries';
import { useUiStore } from '@/state/ui-store';
import { CommandPalette } from './CommandPalette';
import { EmptyState } from './EmptyState';
import { AddFoldersDialog } from './AddFoldersDialog';
import { FirstRunDialog } from './FirstRunDialog';
import { findProjectNode } from './find-project';
import { PortsPage } from '@/ports/PortsPage';
import { ProjectView } from './ProjectView';
import { SettingsDialog } from './SettingsDialog';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';
import { DepsPage } from '@/deps/DepsPage';
import { useAppliedTheme } from '@/lib/use-applied-theme';

export function App() {
  useProjectsChangedSubscription();
  useProcessesChangedSubscription();
  useNavigateSubscription();
  const { data: projects = [], isPending } = useProjects();
  const selectedId = useUiStore((s) => s.selectedProjectId);
  const view = useUiStore((s) => s.view);
  const { data: settings } = useSettings();
  const depsOn = isToolEnabled(settings?.disabledTools ?? [], 'deps');
  // Dependencies turned off while its page is open: back to the projects.
  useEffect(() => {
    if (view === 'deps' && !depsOn) useUiStore.setState({ view: 'project' });
  }, [view, depsOn]);
  useAppliedTheme();
  const node = findProjectNode(projects, selectedId) ?? findProjectNode(projects, projects[0]?.id ?? null);

  return (
    <div className="flex h-full flex-col bg-app text-fg">
      <TitleBar node={node} />
      <div className="flex min-h-0 flex-1">
        <Sidebar projects={projects} selectedId={view === 'project' ? (node?.detected.id ?? null) : null} />
        <main className="flex min-w-0 flex-1 flex-col">
          {view === 'ports' ? (
            <PortsPage />
          ) : view === 'deps' ? (
            <DepsPage />
          ) : isPending ? null : node ? (
            <ProjectView key={node.detected.id} node={node} />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
      <StatusBar projectCount={projects.length} />
      <SettingsDialog />
      <FirstRunDialog />
      <AddFoldersDialog />
      <CommandPalette />
    </div>
  );
}
