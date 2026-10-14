import type { DetectedTask } from '../types';
import type { NodeInfo } from './detect';
import { monorepoTasks, nxCommand } from './monorepo';

/**
 * The package manager's own commands. Only names no package.json script can take:
 * `install` and `ci` are package-manager verbs, not scripts a project defines. On a monorepo root, also
 * `all:<script>`, `turbo:<task>` and `nx:<target>` (monorepo.ts); in an Nx project, `nx:<target>`.
 */
export function nodeTasks(info: NodeInfo): DetectedTask[] {
  const pm = info.packageManager;
  const workspace = monorepoTasks(info);
  const taken = new Set(workspace.map((t) => t.name));
  // An Nx project's own targets; on a root, run-many of the same name wins.
  const project = info.nx;
  const nx = (project?.targets ?? [])
    .map((target) => ({
      name: `nx:${target}`,
      argv: nxCommand(info, ['run', `${project?.project}:${target}`]),
      title: `nx run ${project?.project}:${target}`,
    }))
    .filter((t) => !taken.has(t.name));
  return [
    // A folder without its own package.json (an Nx library) has nothing of its own to install.
    ...(info.packageJson
      ? [
          { name: 'install', argv: [pm, 'install'], title: 'Install dependencies' },
          {
            name: 'ci',
            argv: pm === 'npm' ? ['npm', 'ci'] : [pm, 'install', '--frozen-lockfile'],
            title: 'Clean install from the lockfile',
          },
        ]
      : []),
    ...workspace,
    ...nx,
  ];
}
