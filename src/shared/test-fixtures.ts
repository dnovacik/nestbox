// Test helper shared by node-project tests. Never imported by production modules.
import type { DetectedProject } from './detected';
import { nodeEntry } from './ecosystems/node-fixtures';

export function makeDetectedForTest(over: Partial<DetectedProject> = {}): DetectedProject {
  return {
    id: 'p1',
    rootId: 'p1',
    path: 'C:\\Dev\\Shop',
    relPath: '',
    name: 'shop',
    missing: false,
    envFiles: [], envSymlinks: [],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null, deploy: [],
    git: null,
    buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
    // A package.json named shop, with pnpm's lockfile.
    ecosystems: [nodeEntry({ name: 'shop', scripts: {}, packageManager: 'pnpm' })],
    ...over,
  };
}
