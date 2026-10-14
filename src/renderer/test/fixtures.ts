import type { DetectedProject, ProjectSummary } from '@shared/detected';
import type { NodeInfo } from '@shared/ecosystems/node';
import type { ProcessSummary } from '@shared/processes';

export function makeDetected(over: Partial<DetectedProject> = {}): DetectedProject {
  const project: DetectedProject = {
    id: 'p1',
    rootId: 'p1',
    path: 'C:\\Dev\\Shop',
    relPath: '',
    name: 'shop',
    missing: false,
    packageJson: { name: 'shop', scripts: { dev: 'vite', build: 'vite build' } },
    packageManager: 'pnpm',
    envFiles: ['.env', '.env.example'], envSymlinks: [],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null, deploy: [],
    git: { branch: 'main', head: null },
    buildOutput: null,
    claude: { claudeMd: true, claudeLocalMd: false, claudeDir: true, mcpJson: false },
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

export function makeSummary(over: Partial<ProjectSummary> = {}): ProjectSummary {
  const detected = over.detected ?? makeDetected({ id: over.id ?? 'p1', rootId: over.id ?? 'p1', name: over.name ?? 'shop' });
  return {
    id: detected.id,
    name: detected.name,
    path: detected.path,
    pinned: false,
    tags: [], groupId: null,
    ...over,
    detected,
  };
}

export function makeProcess(over: Partial<ProcessSummary> = {}): ProcessSummary {
  return {
    projectId: 'p1',
    script: 'dev',
    state: 'running',
    pid: 1000,
    startedAt: 1,
    exit: null,
    crashCount: 0,
    autoRestart: false,
    nextRestartAt: null,
    gaveUp: false, warning: null,
    ...over,
  };
}
