// The Node.js ecosystem: folders with a package.json. Detection looks at file names only (detect.ts); the
// module adds the package manager's own commands (tasks.ts).
import type { EcosystemModule } from '../types';
import { detectNode, type NodeInfo, NodeInfoSchema } from './detect';
import { nodeTasks } from './tasks';

export type { NodeInfo } from './detect';

/**
 * Node.js ecosystem module: detects Node.js projects via package.json and offers the
 * package manager's own commands.
 *
 * package.json scripts are already rows of their own (kind 'npm'), so this module never
 * mirrors them: a detected task with a script's name would lose the name-uniqueness check
 * and never show. It adds only what no script provides.
 */
export const nodeModule: EcosystemModule<NodeInfo> = {
  id: 'node',
  infoSchema: NodeInfoSchema,

  detect: detectNode,

  /**
   * A sub-folder with a package.json, one or two levels down (multi-folder projects).
   */
  packageGlobs: ['*/package.json', '*/*/package.json'],

  tasks: nodeTasks,

  /**
   * No special environment: the package manager is expected on PATH.
   */
  async runEnv(_ctx, _info: NodeInfo) {
    return {};
  },

  summary(info: NodeInfo): string | null {
    return `Node.js · ${info.packageManager}`;
  },
};
