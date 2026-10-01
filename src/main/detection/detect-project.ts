import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { type DetectedProject, type PackageManager, workspaceId } from '@shared/detected';
import { isRecord } from '@shared/is-record';
import { isDirectory, isFile } from './fs-utils';
import { readGitInfo } from './git-head';
import { detectPackageManager } from './package-manager';
import { findWorkspaceDirs } from './workspaces';

export type DetectWarning = 'unreadable' | 'invalid-json' | 'not-an-object' | 'invalid-yaml';

export interface DetectInput {
  id: string;
  path: string;
  /** Stored display name; wins over package.json name. */
  name?: string;
}

export interface DetectOptions {
  /** Called with a project-relative file name and a reason. Never receives file contents. */
  onWarning?: (file: string, reason: DetectWarning) => void;
}

interface DirTarget {
  id: string;
  rootId: string;
  path: string;
  relPath: string;
  name?: string;
  inheritedPackageManager?: PackageManager;
}

interface PackageJsonRead {
  raw: Record<string, unknown>;
  info: { name?: string; scripts: Record<string, string> };
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

function label(target: DirTarget, file: string): string {
  return target.relPath ? `${target.relPath}/${file}` : file;
}

async function readPackageJson(
  file: string,
  fileLabel: string,
  options: DetectOptions,
): Promise<PackageJsonRead | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    options.onWarning?.(fileLabel, 'unreadable');
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    options.onWarning?.(fileLabel, 'invalid-json');
    return null;
  }
  if (!isRecord(raw)) {
    options.onWarning?.(fileLabel, 'not-an-object');
    return null;
  }
  const scripts: Record<string, string> = {};
  if (isRecord(raw['scripts'])) {
    for (const [key, value] of Object.entries(raw['scripts'])) {
      if (typeof value === 'string') scripts[key] = value;
    }
  }
  const name = typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'] : undefined;
  return { raw, info: name === undefined ? { scripts } : { name, scripts } };
}

async function detectPrisma(dir: string): Promise<string | null> {
  if (await isFile(join(dir, 'prisma', 'schema.prisma'))) return 'prisma/schema.prisma';
  if (await isDirectory(join(dir, 'prisma', 'schema'))) return 'prisma/schema';
  return null;
}

function missingProject(target: DirTarget): DetectedProject {
  return {
    id: target.id,
    rootId: target.rootId,
    path: target.path,
    relPath: target.relPath,
    name: target.name ?? basename(target.path),
    missing: true,
    packageJson: null,
    packageManager: null,
    envFiles: [],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null,
    git: null,
    buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
  };
}

async function detectDir(
  target: DirTarget,
  options: DetectOptions,
): Promise<{ detected: DetectedProject; rawPackageJson: Record<string, unknown> | null }> {
  if (!(await isDirectory(target.path))) {
    return { detected: missingProject(target), rawPackageJson: null };
  }
  const entries: Dirent[] = await readdir(target.path, { withFileTypes: true }).catch(() => []);
  const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));

  const pkg = files.has('package.json')
    ? await readPackageJson(join(target.path, 'package.json'), label(target, 'package.json'), options)
    : null;

  const detected: DetectedProject = {
    id: target.id,
    rootId: target.rootId,
    path: target.path,
    relPath: target.relPath,
    name: target.name ?? pkg?.info.name ?? basename(target.path),
    missing: false,
    packageJson: pkg?.info ?? null,
    packageManager: target.inheritedPackageManager ?? detectPackageManager(files),
    envFiles: [...files].filter((n) => n.startsWith('.env')).sort(),
    workspaces: [],
    prismaSchema: await detectPrisma(target.path),
    dockerCompose: COMPOSE_FILES.find((f) => files.has(f)) ?? null,
    git: await readGitInfo(target.path),
    buildOutput: dirs.has('dist') ? 'dist' : dirs.has('build') ? 'build' : null,
    claude: {
      claudeMd: files.has('CLAUDE.md'),
      claudeLocalMd: files.has('CLAUDE.local.md'),
      claudeDir: dirs.has('.claude'),
      mcpJson: files.has('.mcp.json'),
    },
  };
  return { detected, rawPackageJson: pkg?.raw ?? null };
}

export async function detectProject(
  input: DetectInput,
  options: DetectOptions = {},
): Promise<DetectedProject> {
  const { detected: root, rawPackageJson } = await detectDir(
    { id: input.id, rootId: input.id, path: input.path, relPath: '', ...(input.name ? { name: input.name } : {}) },
    options,
  );
  if (root.missing) return root;

  const relDirs = await findWorkspaceDirs(input.path, rawPackageJson, options);
  const workspaces = await Promise.all(
    relDirs.map(async (rel) => {
      const { detected } = await detectDir(
        {
          id: workspaceId(input.id, rel),
          rootId: input.id,
          path: join(input.path, ...rel.split('/')),
          relPath: rel,
          ...(root.packageManager ? { inheritedPackageManager: root.packageManager } : {}),
        },
        options,
      );
      return detected;
    }),
  );
  return { ...root, workspaces };
}
