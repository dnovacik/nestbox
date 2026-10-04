// `docker compose config --services` and `ps --format json`. Only the service, state, health, exit code and
// published ports are kept: commands and labels can carry env values.
import {
  SERVICE_NAME,
  type ServicePort,
  type ServiceState,
  type ServiceView,
} from '@shared/tools/compose/contract';

export interface Container {
  service: string;
  state: Exclude<ServiceState, 'not-created'>;
  health: ServiceView['health'];
  exitCode: number | null;
  ports: ServicePort[];
}

const STATES = new Set([
  'created',
  'restarting',
  'running',
  'removing',
  'paused',
  'exited',
  'dead',
]);
const HEALTH = new Set(['healthy', 'unhealthy', 'starting']);

export function parseServices(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => SERVICE_NAME.test(line));
}

export function servicePorts(publishers: unknown): ServicePort[] {
  if (!Array.isArray(publishers)) return [];
  const out: ServicePort[] = [];
  for (const p of publishers as Record<string, unknown>[]) {
    const published = p?.PublishedPort;
    const target = p?.TargetPort;
    const protocol = typeof p?.Protocol === 'string' ? p.Protocol : 'tcp';
    if (typeof published !== 'number' || typeof target !== 'number' || published <= 0) continue;
    // Docker lists a port once for 0.0.0.0 and once for ::.
    if (
      out.some((o) => o.published === published && o.target === target && o.protocol === protocol)
    )
      continue;
    out.push({ published, target, protocol });
  }
  return out;
}

function toContainer(raw: unknown): Container | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.Service !== 'string' || !SERVICE_NAME.test(r.Service)) return null;
  const state =
    typeof r.State === 'string' && STATES.has(r.State) ? (r.State as Container['state']) : 'dead';
  const health =
    typeof r.Health === 'string' && HEALTH.has(r.Health) ? (r.Health as Container['health']) : null;
  return {
    service: r.Service,
    state,
    health,
    exitCode: typeof r.ExitCode === 'number' && Number.isInteger(r.ExitCode) ? r.ExitCode : null,
    ports: servicePorts(r.Publishers),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Older Compose prints one JSON array, newer one object per line. */
export function parsePs(stdout: string): Container[] {
  const trimmed = stdout.trim();
  if (trimmed === '') return [];
  const raws = trimmed.startsWith('[')
    ? ((parseJson(trimmed) as unknown[] | undefined) ?? [])
    : trimmed.split(/\r?\n/).map(parseJson);
  return (Array.isArray(raws) ? raws : [])
    .map(toContainer)
    .filter((c): c is Container => c !== null);
}

const RANK: Record<Container['state'], number> = {
  running: 0,
  restarting: 1,
  paused: 2,
  created: 3,
  removing: 4,
  exited: 5,
  dead: 6,
};

/** One view per service, in the file's order; a scaled service shows its most alive container. */
export function mergeServices(
  names: readonly string[],
  containers: readonly Container[],
): ServiceView[] {
  return names.map((name) => {
    const best = containers
      .filter((c) => c.service === name)
      .sort((a, b) => RANK[a.state] - RANK[b.state])[0];
    if (!best) return { name, state: 'not-created', health: null, exitCode: null, ports: [] };
    return {
      name,
      state: best.state,
      health: best.health,
      exitCode: best.exitCode,
      ports: best.ports,
    };
  });
}
