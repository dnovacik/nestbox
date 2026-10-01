import type { ProjectNode } from './find-project';

export function ProjectView({ node }: { node: ProjectNode }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-fg">{node.detected.name}</h1>
    </div>
  );
}
