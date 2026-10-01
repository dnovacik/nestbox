import { Suspense } from 'react';
import type { ToolSummary } from '@shared/tool';
import { getRendererTool } from '@/tools/registry';
import { PortsCard } from './PortsCard';

export function OverviewGrid({ projectId, tools }: { projectId: string; tools: ToolSummary[] }) {
  const cards = tools.flatMap((tool) => {
    const Card = getRendererTool(tool.id)?.OverviewCard;
    return Card ? [{ id: tool.id, Card }] : [];
  });
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {/* A core card: ports are machine-wide, not a tool. */}
      <PortsCard projectId={projectId} />
      <Suspense fallback={null}>
        {cards.map(({ id, Card }) => (
          <Card key={id} projectId={projectId} />
        ))}
      </Suspense>
    </div>
  );
}
