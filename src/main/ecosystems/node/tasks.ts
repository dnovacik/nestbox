import type { DetectedTask } from '../types';
import type { NodeInfo } from './detect';

/**
 * The package manager's own commands. Only names no package.json script can take:
 * `install` and `ci` are package-manager verbs, not scripts a project defines.
 */
export function nodeTasks(info: NodeInfo): DetectedTask[] {
  const pm = info.packageManager;
  return [
    { name: 'install', argv: [pm, 'install'], title: 'Install dependencies' },
    {
      name: 'ci',
      argv: pm === 'npm' ? ['npm', 'ci'] : [pm, 'install', '--frozen-lockfile'],
      title: 'Clean install from the lockfile',
    },
  ];
}
