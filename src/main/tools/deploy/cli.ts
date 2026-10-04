// Which CLI talks to a platform: the package's own (a devDependency, run through the package manager without
// installing anything), else the one on PATH. The CLI's login is the only credential: NestBox keeps none.
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DeployPlatform, PackageManager } from '@shared/detected';

export interface Cli {
  kind: 'local' | 'global';
  command: string;
  /** Arguments before the CLI's own (`exec wrangler` for pnpm). */
  prefix: string[];
}

const NPM_PACKAGE: Record<DeployPlatform, { pkg: string; bin: string } | null> = {
  vercel: { pkg: 'vercel', bin: 'vercel' },
  netlify: { pkg: 'netlify-cli', bin: 'netlify' },
  cloudflare: { pkg: 'wrangler', bin: 'wrangler' },
  fly: null,
};

const GLOBAL: Record<DeployPlatform, string[]> = {
  vercel: ['vercel'],
  netlify: ['netlify'],
  cloudflare: ['wrangler'],
  fly: ['flyctl', 'fly'],
};

/** Shown with Copy when the CLI is missing. */
export const INSTALL: Record<DeployPlatform, string> = {
  vercel: 'npm i -g vercel',
  netlify: 'npm i -g netlify-cli',
  cloudflare: 'npm i -D wrangler',
  fly: 'https://fly.io/docs/flyctl/install/',
};

const LOGIN: Record<DeployPlatform, string[]> = {
  vercel: ['login'],
  netlify: ['login'],
  cloudflare: ['login'],
  fly: ['auth', 'login'],
};

export const LINK: Partial<Record<DeployPlatform, string[]>> = {
  vercel: ['link'],
  netlify: ['link'],
};

async function resolvesFrom(dir: string, pkg: string): Promise<boolean> {
  for (let current = dir; ;) {
    if ((await stat(join(current, 'node_modules', pkg, 'package.json')).catch(() => null)) !== null)
      return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function throughManager(pm: PackageManager | null, bin: string): Omit<Cli, 'kind'> {
  switch (pm) {
    case 'pnpm':
      return { command: 'pnpm', prefix: ['exec', bin] };
    case 'yarn':
      return { command: 'yarn', prefix: [bin] };
    case 'bun':
      return { command: 'bunx', prefix: ['--no-install', bin] };
    default:
      return { command: 'npx', prefix: ['--no-install', bin] };
  }
}

/** `exists` is the adapter's commandExists: null (couldn't tell) counts as installed, so the CLI's own error shows. */
export async function resolveCli(
  platform: DeployPlatform,
  dir: string,
  pm: PackageManager | null,
  exists: (command: string) => Promise<boolean | null>,
): Promise<Cli | null> {
  const local = NPM_PACKAGE[platform];
  if (local && (await resolvesFrom(dir, local.pkg)))
    return { kind: 'local', ...throughManager(pm, local.bin) };
  for (const command of GLOBAL[platform]) {
    if ((await exists(command)) !== false) return { kind: 'global', command, prefix: [] };
  }
  return null;
}

export function cliCommand(cli: Cli, args: readonly string[]): { command: string; args: string[] } {
  return { command: cli.command, args: [...cli.prefix, ...args] };
}

const terminalLine = (cli: Cli, args: readonly string[]) =>
  [cli.command, ...cli.prefix, ...args].join(' ');

export function loginCommand(platform: DeployPlatform, cli: Cli): string {
  return terminalLine(cli, LOGIN[platform]);
}

export function linkCommand(platform: DeployPlatform, cli: Cli): string | null {
  const args = LINK[platform];
  return args ? terminalLine(cli, args) : null;
}
