// Test helper shared by node-project tests. Never imported by production modules.
import type { DetectedProject } from './detected';
import type { NodeInfo } from './ecosystems/node';

export function makeDetectedForTest(over: Partial<DetectedProject> = {}): DetectedProject {
  const project: DetectedProject = {
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
    dockerCompose: null, deploy: [],
    git: null,
    buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
    ecosystems: [],
    ...over,
  };
  return withNodeEntry(project);
}

/**
 * Until the deprecated fields go (#63), a fixture's packageJson and packageManager also make its Node entry,
 * as detection does, unless the test gives one.
 */
function withNodeEntry(project: DetectedProject): DetectedProject {
  if (project.packageJson === null || project.ecosystems.some((e) => e.id === 'node'))
    return project;
  const node: NodeInfo = {
    name: project.packageJson.name ?? null,
    scripts: project.packageJson.scripts,
    packageManager: project.packageManager ?? 'npm',
    packageManagerSource: project.packageManager === null ? 'default' : 'lockfile',
    lockfiles: [],
    framework: null,
    ports: [],
    hasDependencies: false,
    monorepo: null,
  };
  return { ...project, ecosystems: [...project.ecosystems, { id: 'node', info: node }] };
}
