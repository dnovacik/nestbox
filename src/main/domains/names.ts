// Host names for projects: a root is <label>.localhost, a workspace package <package>.<root>.localhost.
// Labels come from display names (or the user's override) and are unique per level.
import { LABEL } from '@shared/domains';

export interface NamedProject {
  id: string;
  name: string;
  workspaces: readonly { id: string; name: string; relPath: string }[];
}

/** A display name as one DNS label: lowercase [a-z0-9-], no edge or repeated dashes, at most 63. */
export function toLabel(text: string): string {
  const label = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
  return LABEL.test(label) ? label : 'project';
}

/** A workspace package's label: its name without an npm scope, else its folder's last part. */
export function packageLabel(name: string, relPath: string): string {
  const unscoped = name.startsWith('@') ? (name.split('/')[1] ?? '') : name;
  return toLabel(unscoped || relPath.split('/').pop() || '');
}

function unique(label: string, taken: Set<string>): string {
  let candidate = label;
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = `-${n}`;
    candidate = `${label.slice(0, 63 - suffix.length)}${suffix}`;
  }
  taken.add(candidate);
  return candidate;
}

export function assignNames(
  projects: readonly NamedProject[],
  overrides: Readonly<Record<string, string>>,
): { names: Map<string, string>; clashes: string[] } {
  const names = new Map<string, string>();
  const clashes: string[] = [];
  const roots = new Set<string>();
  for (const project of projects) {
    const wanted = overrides[project.id] ?? toLabel(project.name);
    const root = unique(wanted, roots);
    if (root !== wanted) clashes.push(project.id);
    names.set(project.id, `${root}.localhost`);
    const inRoot = new Set<string>();
    for (const ws of project.workspaces) {
      const wsWanted = overrides[ws.id] ?? packageLabel(ws.name, ws.relPath);
      const label = unique(wsWanted, inRoot);
      if (label !== wsWanted) clashes.push(ws.id);
      names.set(ws.id, `${label}.${root}.localhost`);
    }
  }
  return { names, clashes };
}
