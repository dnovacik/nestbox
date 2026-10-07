// The .NET ecosystem: solutions and C#/F#/VB projects. Detection reads small files only (detect.ts); a
// root solution lists its projects as packages (solution.ts); every command runs `dotnet` with its
// telemetry and banners off, and warns when no installed SDK satisfies global.json (sdk.ts).
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PlatformAdapter } from '../../platform/adapter';
import type { EcosystemModule, RunEnv } from '../types';
import { detectDotnet, type DotnetInfo, DotnetInfoSchema, readSmall } from './detect';
import { sdkWarning, parseListSdks } from './sdk';
import { isTestName, parseSolution, SOLUTION_FILE } from './solution';
import { checkDotnet, dotnetUpdateCommand } from './deps';
import { DOTNET_ENV } from './env';
import { dotnetTasks } from './tasks';

export { DOTNET_ENV } from './env';

export type { DotnetInfo } from './detect';

const SOLUTION_MAX = 1024 * 1024;
const SDK_CACHE_MS = 30_000;
const SDK_TIMEOUT_MS = 3_000;

const PROJECT_GLOBS = ['cs', 'fs', 'vb'].flatMap((x) => [`*/*.${x}proj`, `*/*/*.${x}proj`]);

const isFile = (path: string): Promise<boolean> =>
  stat(path).then(
    (s) => s.isFile(),
    () => false,
  );

/** The projects of the root's solutions (.sln, .slnx), minus test projects. */
async function solutionProjects(root: string): Promise<string[]> {
  const names = await readdir(root).catch(() => [] as string[]);
  const dirs: string[] = [];
  for (const name of names.filter((n) => SOLUTION_FILE.test(n)).sort()) {
    const text = await readSmall(join(root, name), SOLUTION_MAX);
    if (text === null) continue;
    for (const path of parseSolution(name, text)) {
      const parts = path.split('/');
      const file = parts.pop() ?? '';
      if (parts.length === 0) continue; // a project next to the solution is the root itself
      if ([...parts, file.replace(/\.\w+proj$/i, '')].some(isTestName)) continue;
      dirs.push(parts.join('/'));
    }
  }
  return dirs;
}

export interface DotnetModuleDeps {
  now(): number;
  /** The user's home folder, for an SDK installed by dotnet-install into ~/.dotnet. */
  home: string;
}

export function createDotnetModule(deps: DotnetModuleDeps = { now: Date.now, home: homedir() }) {
  let sdkCache: { command: string; at: number; versions: string[] | null } | null = null;

  /** `dotnet`, or the ~/.dotnet copy when dotnet isn't on PATH; null when neither is found. */
  async function locate(
    platform: PlatformAdapter,
  ): Promise<{ command: string; dir: string | null } | null> {
    if ((await platform.commandExists('dotnet')) !== false) return { command: 'dotnet', dir: null };
    const dir = join(deps.home, '.dotnet');
    for (const exe of ['dotnet', 'dotnet.exe']) {
      if (await isFile(join(dir, exe))) return { command: join(dir, exe), dir };
    }
    return null;
  }

  /** Installed SDK versions (30 s cache); null when `dotnet --list-sdks` fails. */
  async function installedSdks(
    platform: PlatformAdapter,
    command: string,
    cwd: string,
  ): Promise<string[] | null> {
    const now = deps.now();
    if (sdkCache && sdkCache.command === command && now - sdkCache.at < SDK_CACHE_MS)
      return sdkCache.versions;
    const result = await platform
      .execCommand(command, ['--list-sdks'], { cwd, timeoutMs: SDK_TIMEOUT_MS, env: DOTNET_ENV })
      .catch(() => null);
    const versions = result && result.code === 0 ? parseListSdks(result.stdout) : null;
    sdkCache = { command, at: now, versions };
    return versions;
  }

  const module: EcosystemModule<DotnetInfo> = {
    id: 'dotnet',
    infoSchema: DotnetInfoSchema,

    detect: (dir, files) => detectDotnet(dir, files),

    packageGlobs: PROJECT_GLOBS,

    skipDir: (name) => name === 'bin' || name === 'obj' || isTestName(name),

    workspaceDirs: solutionProjects,

    tasks: dotnetTasks,

    deps: checkDotnet,

    depsUpdateCommand: dotnetUpdateCommand,

    async runEnv(ctx, info): Promise<RunEnv> {
      const found = await locate(ctx.platform);
      if (found === null)
        return { env: DOTNET_ENV, warning: "dotnet isn't on PATH: install the .NET SDK" };
      const versions =
        info.sdk === null ? null : await installedSdks(ctx.platform, found.command, ctx.dir);
      const warning = versions === null ? null : sdkWarning(info.sdk, versions);
      return {
        env: DOTNET_ENV,
        ...(found.dir === null
          ? {}
          : { pathPrepend: found.dir, note: `Using the .NET SDK in ${found.dir}` }),
        ...(warning === null ? {} : { warning }),
      };
    },

    ports: (info) =>
      info.launchProfiles.flatMap((p) => p.ports).filter((p, i, all) => all.indexOf(p) === i),

    summary(info) {
      const parts = ['.NET'];
      if (info.targetFrameworks.length > 0) parts.push(info.targetFrameworks.join(', '));
      if (info.isWeb) parts.push('web');
      if (info.isTest) parts.push('tests');
      if (info.solution !== null && info.project === null) parts.push('solution');
      if (info.sdk !== null) parts.push(`SDK ${info.sdk.version}`);
      return parts.join(' · ');
    },
  };
  return module;
}

export const dotnetModule = createDotnetModule();
