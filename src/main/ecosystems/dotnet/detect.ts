// .NET detection of one folder: the solution and project file names, a few facts from the project file,
// the launch profiles' names and http ports, and the SDK pinned by global.json. Small capped reads, no
// subprocess. Launch profiles' environmentVariables and anything else in those files is never kept.
import { open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { PROJECT_FILE, SOLUTION_FILE } from './solution';

const PROJECT_MAX = 256 * 1024;
const LAUNCH_SETTINGS_MAX = 64 * 1024;
const GLOBAL_JSON_MAX = 16 * 1024;

export const ROLL_FORWARD = [
  'patch',
  'feature',
  'minor',
  'major',
  'latestPatch',
  'latestFeature',
  'latestMinor',
  'latestMajor',
  'disable',
] as const;

/** A launch profile name that can travel as one argv token (`--launch-profile <name>`). */
export const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,40}$/;
const SDK_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export const DotnetInfoSchema = z.object({
  /** A solution file in this folder (.sln or .slnx), by name. */
  solution: z.string().nullable(),
  /** A project file in this folder (.csproj, .fsproj, .vbproj), by name. */
  project: z.string().nullable(),
  /** TargetFramework or TargetFrameworks, e.g. ['net8.0']. */
  targetFrameworks: z.array(z.string()),
  /** Microsoft.NET.Sdk.Web (ASP.NET Core) or Blazor WebAssembly. */
  isWeb: z.boolean(),
  /** A test project (IsTestProject, or a test SDK or framework package). */
  isTest: z.boolean(),
  /** The SDK global.json asks for (this folder or above), with its roll-forward policy. */
  sdk: z.object({ version: z.string(), rollForward: z.enum(ROLL_FORWARD) }).nullable(),
  /** `Project` launch profiles: the name and the http (not https) ports of applicationUrl. */
  launchProfiles: z.array(z.object({ name: z.string(), ports: z.array(z.number().int()) })),
});
export type DotnetInfo = z.infer<typeof DotnetInfoSchema>;

/** A small text file, BOM stripped; null when it is missing, too big or unreadable. */
export async function readSmall(path: string, max: number): Promise<string | null> {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch {
    return null;
  }
  try {
    if (!(await handle.stat()).isFile() || (await handle.stat()).size > max) return null;
    return (await handle.readFile('utf8')).replace(/^\uFEFF/, '');
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const TEST_PACKAGES =
  /^(?:Microsoft\.NET\.Test\.Sdk|xunit|xunit\.v3|NUnit|MSTest|MSTest\.TestFramework|TUnit)$/i;

export function parseProjectFile(
  xml: string,
): Pick<DotnetInfo, 'targetFrameworks' | 'isWeb' | 'isTest'> {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const sdk = /<Project\b[^>]*\bSdk\s*=\s*"([^"]*)"/i.exec(text)?.[1] ?? '';
  const frameworks =
    /<TargetFrameworks?>\s*([^<]*?)\s*<\/TargetFrameworks?>/i.exec(text)?.[1] ?? '';
  const packages = [...text.matchAll(/<PackageReference\b[^>]*\bInclude\s*=\s*"([^"]+)"/gi)].map(
    (m) => m[1] ?? '',
  );
  return {
    targetFrameworks: frameworks
      .split(';')
      .map((f) => f.trim())
      .filter((f) => /^[A-Za-z0-9.-]{1,40}$/.test(f)),
    isWeb: /\bMicrosoft\.NET\.Sdk\.(?:Web|BlazorWebAssembly)\b/i.test(sdk),
    isTest:
      /<IsTestProject>\s*true\s*<\/IsTestProject>/i.test(text) ||
      /\bMSTest\.Sdk\b/i.test(sdk) ||
      packages.some((p) => TEST_PACKAGES.test(p)),
  };
}

/** The http ports of an applicationUrl such as `https://localhost:7031;http://localhost:5283`. */
function httpPorts(applicationUrl: unknown): number[] {
  if (typeof applicationUrl !== 'string') return [];
  const ports: number[] = [];
  for (const url of applicationUrl.split(';')) {
    const port = /^\s*http:\/\/[^/:;]+:(\d{1,5})(?:\/|\s*$)/i.exec(url)?.[1];
    const n = Number(port);
    if (port && n >= 1 && n <= 65535 && !ports.includes(n)) ports.push(n);
  }
  return ports;
}

export function parseLaunchSettings(text: string | null): DotnetInfo['launchProfiles'] {
  const json = parseJson(text);
  const profiles = isObject(json) ? json['profiles'] : null;
  if (!isObject(profiles)) return [];
  return Object.entries(profiles)
    .filter(([name, p]) => PROFILE_NAME.test(name) && isObject(p) && p['commandName'] === 'Project')
    .slice(0, 20)
    .map(([name, p]) => ({
      name,
      ports: httpPorts((p as Record<string, unknown>)['applicationUrl']),
    }));
}

export function parseGlobalJson(text: string | null): DotnetInfo['sdk'] {
  const json = parseJson(text);
  const sdk = isObject(json) ? json['sdk'] : null;
  if (!isObject(sdk) || typeof sdk['version'] !== 'string' || !SDK_VERSION.test(sdk['version']))
    return null;
  const policy = ROLL_FORWARD.find((p) => p === sdk['rollForward']);
  return { version: sdk['version'], rollForward: policy ?? 'latestPatch' };
}

/** global.json applies from the nearest folder at or above `dir`, as dotnet looks it up. */
async function findGlobalJson(dir: string): Promise<DotnetInfo['sdk']> {
  for (let current = dir; ; current = dirname(current)) {
    const text = await readSmall(join(current, 'global.json'), GLOBAL_JSON_MAX);
    if (text !== null) return parseGlobalJson(text);
    if (dirname(current) === current) return null;
  }
}

const firstSorted = (files: ReadonlySet<string>, pattern: RegExp): string | null =>
  [...files].filter((f) => pattern.test(f)).sort()[0] ?? null;

export async function detectDotnet(
  dir: string,
  files: ReadonlySet<string>,
): Promise<DotnetInfo | null> {
  const solution = firstSorted(files, SOLUTION_FILE);
  const project = firstSorted(files, PROJECT_FILE);
  if (solution === null && project === null) return null;
  const facts =
    project === null
      ? { targetFrameworks: [], isWeb: false, isTest: false }
      : parseProjectFile((await readSmall(join(dir, project), PROJECT_MAX)) ?? '');
  const launchProfiles =
    project === null
      ? []
      : parseLaunchSettings(
          await readSmall(join(dir, 'Properties', 'launchSettings.json'), LAUNCH_SETTINGS_MAX),
        );
  return { solution, project, ...facts, sdk: await findGlobalJson(dir), launchProfiles };
}
