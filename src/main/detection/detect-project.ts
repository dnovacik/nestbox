import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  type DeployPlatform,
  type DetectedProject,
  type EcosystemEntry,
  workspaceId,
} from '@shared/detected';
import { nodeOf } from '@shared/ecosystems/node';
import { ECOSYSTEM_MODULES } from '../ecosystems';
import type { DetectContext } from '../ecosystems/types';
import { isDirectory, isFile } from './fs-utils';
import { readGitInfo } from './git-head';
import { findWorkspaceDirs } from './workspaces';

export type DetectWarning = 'unreadable' | 'invalid-json' | 'not-an-object' | 'invalid-yaml' | 'outside-root';

/** `.env`, `.env.local`, `.env.production.local`, … but not `.envrc`. */
export const ENV_FILE_PATTERN = /^\.env(\..+)?$/;

export interface DetectInput {
  id: string;
  path: string;
  /** Stored display name; wins over the package's own name (package.json's). */
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
  /** The root's names, for a workspace package: its package manager comes from the root's lockfile. */
  root?: NonNullable<DetectContext['root']>;
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

/** What marks a package as deployed to each platform: config files, or the folder its CLI writes when linking. */
const DEPLOY_MARKERS: [DeployPlatform, { files: string[]; dirs: string[] }][] = [
  ['vercel', { files: ['vercel.json'], dirs: ['.vercel'] }],
  ['netlify', { files: ['netlify.toml'], dirs: ['.netlify'] }],
  ['cloudflare', { files: ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc'], dirs: [] }],
  ['fly', { files: ['fly.toml'], dirs: [] }],
];

function detectDeploy(files: ReadonlySet<string>, dirs: ReadonlySet<string>): DeployPlatform[] {
  return DEPLOY_MARKERS.filter(([, m]) => m.files.some((f) => files.has(f)) || m.dirs.some((d) => dirs.has(d))).map(
    ([platform]) => platform,
  );
}

function label(target: DirTarget, file: string): string {
  return target.relPath ? `${target.relPath}/${file}` : file;
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
    envSymlinks: [],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null,
    deploy: [],
    git: null,
    buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
    ecosystems: [],
  };
}

async function detectDir(
  target: DirTarget,
  options: DetectOptions,
): Promise<{ detected: DetectedProject; names: NonNullable<DetectContext['root']> | null }> {
  if (!(await isDirectory(target.path))) {
    return { detected: missingProject(target), names: null };
  }
  const entries: Dirent[] = await readdir(target.path, { withFileTypes: true }).catch(() => {
    options.onWarning?.(target.relPath || '.', 'unreadable');
    return [];
  });
  const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  const envNames = entries.filter((e) => ENV_FILE_PATTERN.test(e.name)).map((e) => e.name);
  const envSymlinks: string[] = [];
  const envFiles: string[] = [];
  for (const name of envNames) {
    const entry = entries.find((e) => e.name === name);
    if (entry?.isFile()) envFiles.push(name);
    else if (entry?.isSymbolicLink() && (await isFile(join(target.path, name)))) {
      envFiles.push(name);
      envSymlinks.push(name);
    }
  }

  // Detect ecosystem modules (Node's reads package.json: the name and scripts come from it)
  const ecosystems: EcosystemEntry[] = [];
  const ctx: DetectContext = {
    root: target.root ?? null,
    onWarning: (file, reason) => options.onWarning?.(label(target, file), reason),
  };
  for (const module of ECOSYSTEM_MODULES) {
    const info = await module.detect(target.path, files, dirs, ctx);
    if (info !== null) {
      try {
        const validated = module.infoSchema.parse(info);
        const summary = module.summary?.(validated) ?? null;
        ecosystems.push({ id: module.id, info: validated, ...(summary === null ? {} : { summary }) });
      } catch {
        // Invalid info from detect() — skip this module
      }
    }
  }

  const node = nodeOf({ ecosystems });
  const detected: DetectedProject = {
    id: target.id,
    rootId: target.rootId,
    path: target.path,
    relPath: target.relPath,
    name: target.name ?? node?.name ?? basename(target.path),
    missing: false,
    // Deprecated copies of the Node entry (#63), until every reader uses nodeOf().
    packageJson: node && (node.name === null ? { scripts: node.scripts } : { name: node.name, scripts: node.scripts }),
    packageManager: node && node.packageManagerSource !== 'default' ? node.packageManager : null,
    envFiles: envFiles.sort(),
    envSymlinks: envSymlinks.sort(),
    workspaces: [],
    prismaSchema: await detectPrisma(target.path),
    dockerCompose: COMPOSE_FILES.find((f) => files.has(f)) ?? null,
    deploy: detectDeploy(files, dirs),
    git: await readGitInfo(target.path),
    buildOutput: dirs.has('dist') ? 'dist' : dirs.has('build') ? 'build' : null,
    claude: {
      claudeMd: files.has('CLAUDE.md'),
      claudeLocalMd: files.has('CLAUDE.local.md'),
      claudeDir: dirs.has('.claude'),
      mcpJson: files.has('.mcp.json'),
    },
    ecosystems,
  };
  return { detected, names: { path: target.path, files, dirs } };
}

export async function detectProject(
  input: DetectInput,
  options: DetectOptions = {},
): Promise<DetectedProject> {
  const { detected: root, names } = await detectDir(
    { id: input.id, rootId: input.id, path: input.path, relPath: '', ...(input.name ? { name: input.name } : {}) },
    options,
  );
  if (root.missing) return root;

  const relDirs = await findWorkspaceDirs(input.path, options);
  const workspaces = await Promise.all(
    relDirs.map(async (rel) => {
      const { detected } = await detectDir(
        {
          id: workspaceId(input.id, rel),
          rootId: input.id,
          path: join(input.path, ...rel.split('/')),
          relPath: rel,
          ...(names ? { root: names } : {}),
        },
        options,
      );
      return detected;
    }),
  );
  return { ...root, workspaces };
}
