import type { DetectedProject, ProjectSummary } from '@shared/detected';
import { nodeEntry } from '@shared/ecosystems/node-fixtures';
import type { ProcessSummary } from '@shared/processes';

export function makeDetected(over: Partial<DetectedProject> = {}): DetectedProject {
  return {
    id: 'p1',
    rootId: 'p1',
    path: 'C:\\Dev\\Shop',
    relPath: '',
    name: 'shop',
    missing: false,
    envFiles: ['.env', '.env.example'], envSymlinks: [],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null, deploy: [],
    git: { branch: 'main', head: null },
    buildOutput: null,
    claude: { claudeMd: true, claudeLocalMd: false, claudeDir: true, mcpJson: false },
    // A package.json named shop, with pnpm's lockfile.
    ecosystems: [nodeEntry({ name: 'shop', scripts: { dev: 'vite', build: 'vite build' }, packageManager: 'pnpm' })],
    ...over,
  };
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
