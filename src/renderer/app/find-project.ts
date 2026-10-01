import { type DetectedProject, findDetected, type ProjectSummary, splitProjectId } from '@shared/detected';

export interface ProjectNode {
  /** The root project (stored fields: pinned, name, …). */
  summary: ProjectSummary;
  /** The selected root or workspace package. */
  detected: DetectedProject;
  isWorkspace: boolean;
}

export function findProjectNode(projects: readonly ProjectSummary[], id: string | null): ProjectNode | null {
  if (!id) return null;
  const summary = projects.find((p) => p.id === splitProjectId(id).rootId);
  const detected = summary ? findDetected(summary.detected, id) : null;
  if (!summary || !detected) return null;
  return { summary, detected, isWorkspace: detected.relPath !== '' };
}

export function filterProjects(projects: readonly ProjectSummary[], filter: string): ProjectSummary[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return [...projects];
  return projects.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      p.detected.workspaces.some((w) => w.name.toLowerCase().includes(needle)),
  );
}
