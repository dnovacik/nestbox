// Test helper shared by node-project tests. Never imported by production modules.
import type { DetectedProject } from './detected';

export function makeDetectedForTest(over: Partial<DetectedProject> = {}): DetectedProject {
  return {
    id: 'p1',
    rootId: 'p1',
    path: 'C:\\Dev\\Shop',
    relPath: '',
    name: 'shop',
    missing: false,
    packageJson: { name: 'shop', scripts: {} },
    packageManager: 'pnpm',
    envFiles: [], envSymlinks: [],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null,
    git: null,
    buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
    ...over,
  };
}
