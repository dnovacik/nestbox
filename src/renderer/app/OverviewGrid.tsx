import { Suspense } from 'react';
import type { ToolSummary } from '@shared/tool';
import { getRendererTool } from '@/tools/registry';

export function OverviewGrid({ projectId, tools }: { projectId: string; tools: ToolSummary[] }) {
  const cards = tools.flatMap((tool) => {
    const Card = getRendererTool(tool.id)?.OverviewCard;
    return Card ? [{ id: tool.id, Card }] : [];
  });
  if (cards.length === 0) return <p className="text-sm text-fg-muted">No overview cards for this project yet.</p>;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Suspense fallback={null}>
        {cards.map(({ id, Card }) => (
          <Card key={id} projectId={projectId} />
        ))}
      </Suspense>
    </div>
  );
}
