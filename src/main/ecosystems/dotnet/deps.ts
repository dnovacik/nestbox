// The Dependencies tool's .NET check: `dotnet list <project> package --outdated` and
// `--vulnerable --include-transitive`, both as JSON (SDK 7.0.200+). Only package ids, versions, severities
// and https advisory URLs are kept; project paths and sources in the output are dropped.
import type { Advisory, DepRow, Severity, StepError } from '@shared/tools/deps/contract';
import type { DepsRun, EcosystemDeps } from '../types';
import type { DotnetInfo } from './detect';
import { DOTNET_ENV } from './env';

const MAX_ROWS = 1_000;
/** NuGet's package id rule, so an id is safe on a command line ("Copy update command"). */
export const NUGET_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
const VERSION = /^[0-9][0-9A-Za-z.+-]{0,63}$/;

interface Listed {
  id: string;
  requested: string | null;
  resolved: string | null;
  latest: string | null;
  advisories: Advisory[];
  transitive: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, re: RegExp): string | null =>
  typeof v === 'string' && re.test(v) ? v : null;
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const SEVERITY: Record<string, Severity> = {
  low: 'low',
  moderate: 'moderate',
  medium: 'moderate',
  high: 'high',
  critical: 'critical',
};

function advisory(v: unknown): Advisory | null {
  if (!isObject(v)) return null;
  const severity = SEVERITY[String(v['severity']).toLowerCase()];
  const url =
    typeof v['advisoryurl'] === 'string' && /^https:\/\/\S+$/.test(v['advisoryurl'])
      ? v['advisoryurl']
      : null;
  if (!severity) return null;
  const id = url?.split('/').filter(Boolean).pop() ?? 'advisory';
  return { id, title: id, severity, url, range: null };
}

/** The packages of `dotnet list package --format json`, every framework merged; null when it isn't that. */
export function parseListPackage(text: string): Listed[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(json) || !Array.isArray(json['projects'])) return null;
  const byId = new Map<string, Listed>();
  for (const project of json['projects']) {
    for (const framework of array(isObject(project) ? project['frameworks'] : null)) {
      if (!isObject(framework)) continue;
      for (const [field, transitive] of [
        ['topLevelPackages', false],
        ['transitivePackages', true],
      ] as const) {
        for (const pkg of array(framework[field])) {
          const id = isObject(pkg) ? str(pkg['id'], NUGET_ID) : null;
          if (!isObject(pkg) || id === null) continue;
          const found = byId.get(id.toLowerCase());
          const advisories = array(pkg['vulnerabilities'])
            .map(advisory)
            .filter((a): a is Advisory => a !== null);
          if (found) {
            for (const a of advisories)
              if (!found.advisories.some((b) => b.id === a.id)) found.advisories.push(a);
            continue;
          }
          byId.set(id.toLowerCase(), {
            id,
            requested: str(pkg['requestedVersion'], VERSION),
            resolved: str(pkg['resolvedVersion'], VERSION),
            latest: str(pkg['latestVersion'], VERSION),
            advisories,
            transitive,
          });
        }
      }
    }
  }
  return [...byId.values()];
}

const major = (v: string | null): number | null => {
  const n = v === null ? NaN : Number(/^(\d+)/.exec(v)?.[1]);
  return Number.isNaN(n) ? null : n;
};

/** Outdated and vulnerable lists merged into the Dependencies tool's rows. */
export function dotnetRows(outdated: readonly Listed[], vulnerable: readonly Listed[]): DepRow[] {
  const rows = new Map<string, DepRow>();
  const row = (p: Listed): DepRow => ({
    name: p.id,
    type: p.transitive ? null : 'prod',
    range: p.transitive ? null : p.requested,
    current: p.resolved,
    wanted: null,
    latest: null,
    outdated: false,
    major: false,
    advisories: [],
  });
  for (const p of outdated) {
    if (p.latest === null || p.latest === p.resolved) continue;
    const base = major(p.resolved);
    const latest = major(p.latest);
    rows.set(p.id.toLowerCase(), {
      ...row(p),
      latest: p.latest,
      outdated: true,
      major: base !== null && latest !== null && latest > base,
    });
  }
  for (const p of vulnerable) {
    if (p.advisories.length === 0) continue;
    const existing = rows.get(p.id.toLowerCase());
    rows.set(p.id.toLowerCase(), { ...(existing ?? row(p)), advisories: p.advisories });
  }
  return [...rows.values()].slice(0, MAX_ROWS);
}

/** Checks one project; a solution-only folder has nothing of its own (its projects are packages). */
export async function checkDotnet(info: DotnetInfo, run: DepsRun): Promise<EcosystemDeps | null> {
  if (info.project === null) return null;
  const errors: StepError[] = [];
  const list = async (step: StepError['step'], flags: string[]): Promise<Listed[]> => {
    const r = await run(
      'dotnet',
      ['list', info.project as string, 'package', ...flags, '--format', 'json'],
      DOTNET_ENV,
    );
    const parsed = r.code === null ? null : parseListPackage(r.stdout);
    if (parsed) return parsed;
    errors.push({ step, code: r.timedOut ? 'timeout' : 'failed' });
    return [];
  };
  const outdated = await list('outdated', ['--outdated']);
  const vulnerable = await list('audit', ['--vulnerable', '--include-transitive']);
  return { manager: 'dotnet', rows: dotnetRows(outdated, vulnerable), errors };
}

/** "Copy update command": NuGet takes the latest version when none is given. */
export const dotnetUpdateCommand = (name: string): string => `dotnet add package ${name}`;
