import type { DetectedProject, ProjectSummary } from '@shared/detected';

export function makeDetected(over: Partial<DetectedProject> = {}): DetectedProject {
  return {
    id: 'p1',
    rootId: 'p1',
    path: 'C:\\Dev\\Shop',
    relPath: '',
    name: 'shop',
    missing: false,
    packageJson: { name: 'shop', scripts: { dev: 'vite', build: 'vite build' } },
    packageManager: 'pnpm',
    envFiles: ['.env', '.env.example'],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null,
    git: { branch: 'main', head: null },
    buildOutput: null,
    claude: { claudeMd: true, claudeLocalMd: false, claudeDir: true, mcpJson: false },
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
    tags: [],
    ...over,
    detected,
  };
}
