import { describe, expect, it } from 'vitest';
import { type DetectedProject, DetectedProjectSchema, findDetected, splitProjectId, workspaceId } from './detected';

function project(overrides: Partial<DetectedProject> = {}): DetectedProject {
  return {
    id: 'root',
    rootId: 'root',
    path: 'C:\\Dev\\Shop',
    relPath: '',
    name: 'shop',
    missing: false,
    packageJson: { name: 'shop', scripts: { dev: 'vite' } },
    packageManager: 'pnpm',
    python: null,
    envFiles: ['.env', '.env.example'], envSymlinks: [],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null, deploy: [],
    git: { branch: 'main', head: null },
    buildOutput: null,
    claude: { claudeMd: true, claudeLocalMd: false, claudeDir: false, mcpJson: false },
    ...overrides,
  };
}

describe('detected project helpers', () => {
  it('builds and splits workspace ids', () => {
    const id = workspaceId('abc', 'packages/api');
    expect(id).toBe('abc::packages/api');
    expect(splitProjectId(id)).toEqual({ rootId: 'abc', relPath: 'packages/api' });
    expect(splitProjectId('abc')).toEqual({ rootId: 'abc', relPath: '' });
  });

  it('finds the root or a workspace by id', () => {
    const ws = project({ id: 'root::packages/api', relPath: 'packages/api', name: 'api' });
    const root = project({ workspaces: [ws] });
    expect(findDetected(root, 'root')).toBe(root);
    expect(findDetected(root, 'root::packages/api')).toBe(ws);
    expect(findDetected(root, 'root::nope')).toBeNull();
  });

  it('validates recursively and strips unknown fields', () => {
    const ws = project({ id: 'root::a', relPath: 'a' });
    const parsed = DetectedProjectSchema.parse({ ...project({ workspaces: [ws] }), leaked: 'x' });
    expect(parsed).not.toHaveProperty('leaked');
    expect(parsed.workspaces[0]?.id).toBe('root::a');
  });
});
