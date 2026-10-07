// Whether an installed SDK satisfies global.json, following dotnet's roll-forward policies:
// https://learn.microsoft.com/dotnet/core/tools/global-json#rollforward
import type { DotnetInfo } from './detect';

type Policy = NonNullable<DotnetInfo['sdk']>['rollForward'];

interface Version {
  major: number;
  minor: number;
  /** The third number: feature band (hundreds) and patch (the rest), e.g. 414 = band 4, patch 14. */
  patch: number;
  prerelease: boolean;
}

function parse(text: string): Version | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(-\S+)?$/.exec(text.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] !== undefined,
  };
}

const compare = (a: Version, b: Version): number =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch;
const band = (v: Version): number => Math.floor(v.patch / 100);

/** `dotnet --list-sdks`: one `<version> [<folder>]` per line. Only the versions are kept. */
export function parseListSdks(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => /^(\d+\.\d+\.\d+(?:-\S+)?)\s+\[/.exec(line.trim())?.[1])
    .filter((v): v is string => v !== undefined);
}

export function satisfies(required: string, policy: Policy, installed: string): boolean {
  const want = parse(required);
  const have = parse(installed);
  if (!want || !have) return false;
  if (compare(have, want) === 0)
    return have.prerelease === want.prerelease || installed === required;
  if (policy === 'disable' || compare(have, want) < 0 || (have.prerelease && !want.prerelease))
    return false;
  const sameMajor = have.major === want.major;
  const sameMinor = sameMajor && have.minor === want.minor;
  switch (policy) {
    case 'patch':
    case 'latestPatch':
      return sameMinor && band(have) === band(want);
    case 'feature':
    case 'latestFeature':
      return sameMinor;
    case 'minor':
    case 'latestMinor':
      return sameMajor;
    case 'major':
    case 'latestMajor':
      return true;
  }
}

/** The start warning when no installed SDK satisfies global.json; null when one does or none is pinned. */
export function sdkWarning(sdk: DotnetInfo['sdk'], installed: readonly string[]): string | null {
  if (sdk === null || installed.some((v) => satisfies(sdk.version, sdk.rollForward, v)))
    return null;
  const list = installed.length > 0 ? installed.join(', ') : 'none';
  return `global.json asks for .NET SDK ${sdk.version} (rollForward ${sdk.rollForward}); installed: ${list}`;
}
