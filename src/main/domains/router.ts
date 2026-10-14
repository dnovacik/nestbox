// Which port each local domain reaches: the package's main command, else its earliest-started running
// script, else the detected port; other running servers get <script>.<name>.localhost. Pure: the service
// gathers the inputs and rebuilds the table when processes, ports or projects change.
import type { Route } from '@shared/domains';
import type { PortRow } from '@shared/ports';
import { isLive, type ProcessSummary } from '@shared/processes';
import { hostName } from '../net/forward';
import { assignNames, type NamedProject, toLabel } from './names';

export interface RouterInput {
  projects: readonly NamedProject[];
  overrides: Readonly<Record<string, string>>;
  rewriteHost: Readonly<Record<string, true>>;
  /** projectId → the package's main command. */
  mainScripts: ReadonlyMap<string, string>;
  processes: readonly ProcessSummary[];
  ports: readonly PortRow[];
  /** projectId → .env's PORT, else the ecosystems' first detected port. */
  detectedPorts: ReadonlyMap<string, number>;
  /** The proxy's own ports: never a target. */
  ownPorts: readonly number[];
}

export type RouteTarget = Route & { ipv6Only: boolean };

export interface RouteTable {
  routes: Route[];
  clashes: string[];
  byName: ReadonlyMap<string, RouteTarget>;
}

export type Resolution =
  | { kind: 'forward'; route: RouteTarget; port: number }
  | { kind: 'not-running'; route: RouteTarget }
  | { kind: 'unknown'; known: string[] }
  | { kind: 'forbidden' };

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+localhost$/;

export function buildRoutes(input: RouterInput): RouteTable {
  const { names, clashes } = assignNames(input.projects, input.overrides);
  const usable = (row: PortRow) => row.port > 0 && !input.ownPorts.includes(row.port);
  const routes: RouteTarget[] = [];
  const target = (
    projectId: string,
    name: string,
    script: string | null,
    row: PortRow | null,
    source: Route['source'],
    port?: number,
  ): RouteTarget => ({
    name,
    projectId,
    script,
    port: row?.port ?? port ?? null,
    source,
    ipv6Only:
      row !== null && row.addresses.length > 0 && row.addresses.every((a) => a.includes(':')),
    rewriteHost: input.rewriteHost[projectId] === true,
  });

  for (const [projectId, name] of names) {
    // Running scripts in start order, each with its lowest usable listening port.
    const running = input.processes
      .filter((p) => p.projectId === projectId && isLive(p.state))
      .map((p) => {
        const rows = input.ports.filter(
          (r) => r.owner?.projectId === projectId && r.owner.script === p.script && usable(r),
        );
        rows.sort((a, b) => a.port - b.port);
        return { script: p.script, row: rows[0] ?? null };
      })
      .filter((s): s is { script: string; row: PortRow } => s.row !== null);
    const main = input.mainScripts.get(projectId);
    const primary = running.find((s) => s.script === main) ?? running[0] ?? null;
    if (primary) {
      routes.push(
        target(
          projectId,
          name,
          primary.script,
          primary.row,
          primary.script === main ? 'main' : 'script',
        ),
      );
    } else {
      const detected = input.detectedPorts.get(projectId);
      const ok = detected !== undefined && detected > 0 && !input.ownPorts.includes(detected);
      routes.push(
        target(projectId, name, null, null, ok ? 'detected' : 'none', ok ? detected : undefined),
      );
    }
    for (const extra of running) {
      if (extra === primary) continue;
      routes.push(
        target(projectId, `${toLabel(extra.script)}.${name}`, extra.script, extra.row, 'script'),
      );
    }
  }
  const byName = new Map<string, RouteTarget>();
  for (const route of routes) if (!byName.has(route.name)) byName.set(route.name, route);
  return {
    routes: routes.map(({ ipv6Only: _i, ...route }) => route),
    clashes,
    byName,
  };
}

export function resolveHost(table: RouteTable, host: string | undefined): Resolution {
  const name = hostName(host).replace(/\.$/, '');
  if (!HOST.test(name)) return { kind: 'forbidden' };
  const route = table.byName.get(name);
  if (!route) return { kind: 'unknown', known: [...table.byName.keys()].sort() };
  return route.port === null
    ? { kind: 'not-running', route }
    : { kind: 'forward', route, port: route.port };
}
