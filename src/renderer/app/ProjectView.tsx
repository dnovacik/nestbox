import { Suspense } from 'react';
import { useTools } from '@/lib/queries';
import { useUiStore } from '@/state/ui-store';
import { getRendererTool } from '@/tools/registry';
import type { ProjectNode } from './find-project';
import { OverviewGrid } from './OverviewGrid';
import { ProjectHeader } from './ProjectHeader';
import { OVERVIEW_TAB, panelId, tabId, ToolTabs } from './ToolTabs';

export function ProjectView({ node }: { node: ProjectNode }) {
  const projectId = node.detected.id;
  const missing = node.detected.missing;
  const { data: tools = [] } = useTools(missing ? null : projectId);
  const stored = useUiStore((s) => s.activeTab[projectId]);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const active = stored && tools.some((t) => t.id === stored) ? stored : OVERVIEW_TAB;
  const tool = active === OVERVIEW_TAB ? undefined : getRendererTool(active);
  const Panel = tool?.Panel;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ProjectHeader node={node} />
      {!missing && (
        <ToolTabs projectId={projectId} tools={tools} active={active} onSelect={(tab) => setActiveTab(projectId, tab)} />
      )}
      <div
        {...(missing ? {} : { role: 'tabpanel', id: panelId(projectId), 'aria-labelledby': tabId(projectId, active), tabIndex: 0 })}
        className={tool?.fullHeight ? 'min-h-0 flex-1 overflow-hidden p-4' : 'min-h-0 flex-1 overflow-y-auto p-6'}
      >
        {missing ? (
          <p className="text-sm text-fg-muted">
            The project folder no longer exists at <span className="font-mono text-fg">{node.detected.path}</span>.
            Restore it and choose Refresh, or remove the project.
          </p>
        ) : Panel ? (
          <Suspense fallback={null}>
            <Panel projectId={projectId} />
          </Suspense>
        ) : (
          <OverviewGrid projectId={projectId} tools={tools} />
        )}
      </div>
    </div>
  );
}
