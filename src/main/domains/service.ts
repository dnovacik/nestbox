// Local domains: keeps the route table current (rebuilt on process, port and project changes), runs the
// proxy while enabled, and owns the trust flow. The one place that touches the domains settings.
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DomainsSettings, DomainsStatus, ServerState, TrustResult } from '@shared/domains';
import { type ProjectSummary, splitProjectId } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import type { PortList } from '@shared/ports';
import { isLive, type ProcessSummary } from '@shared/processes';
import type { Logger } from '../logger';
import type { LocalCa } from './ca';
import { createDomainsProxy, type SniResolver } from './proxy';
import { buildRoutes, type RouteTable } from './router';

export interface DomainsProject {
  id: string;
  name: string;
  path: string;
  workspaces: readonly { id: string; name: string; relPath: string; path: string }[];
}

/**
 * The sidebar's projects as the router sees them. A summary's workspaces already carry the name the sidebar
 * shows (the user's alias, applied in ProjectService.toSummary), so labels follow renames.
 */
export function toDomainsProjects(summaries: readonly ProjectSummary[]): DomainsProject[] {
  return summaries.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    workspaces: p.detected.workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      relPath: w.relPath,
      path: w.path,
    })),
  }));
}

export interface DomainsServiceDeps {
  settings: { get(): DomainsSettings; update(fn: (s: DomainsSettings) => DomainsSettings): void };
  /** Root projects in sidebar order (the router numbers clashing names in this order). */
  projects(): Promise<DomainsProject[]>;
  /** The package's main command (Scripts tool settings), or null. */
  mainScript(projectId: string): string | null;
  processes(): readonly ProcessSummary[];
  ports(): Promise<PortList>;
  /** .env's PORT, else the ecosystems' first detected port; null when neither. */
  detectedPort(projectId: string, dir: string): Promise<number | null>;
  ca: LocalCa;
  trust: {
    trust(certFile: string): Promise<'trusted' | 'cancelled' | 'failed'>;
    untrust(ids: { sha1: string; serialHex: string }): Promise<'removed' | 'failed'>;
  };
  /** The native confirmation; true = go ahead. */
  confirm(kind: 'trust' | 'remove'): Promise<boolean>;
  emit(): void;
  logger: Logger;
  hosts?: readonly string[];
}

export interface DomainsService {
  status(): Promise<DomainsStatus>;
  setEnabled(enabled: boolean): Promise<DomainsStatus>;
  setPorts(p: { httpPort: number; httpsPort: number }): Promise<DomainsStatus>;
  setName(i: { projectId: string; label: string | null }): Promise<DomainsStatus>;
  setRewriteHost(i: { projectId: string; rewrite: boolean }): Promise<DomainsStatus>;
  trustCa(): Promise<TrustResult>;
  removeCa(): Promise<TrustResult>;
  /** Process, port or project changes: rebuild soon (debounced). */
  refresh(): void;
  /** At startup: start the servers if enabled. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

const EMPTY: RouteTable = { routes: [], clashes: [], byName: new Map() };
const REBUILD_MS = 200;
/** While a script runs, ports can open late (a dev server compiling): look again this often. */
const POLL_MS = 5_000;

export function createDomainsService(deps: DomainsServiceDeps): DomainsService {
  let table: RouteTable = EMPTY;
  /** The last routes and clashes sent out: domains:changed goes out only when they differ. */
  let shown = '';
  /** Set by refresh() while off: no work then, status() rebuilds when it is next asked. */
  let dirty = false;
  const off = (port: number): ServerState => ({ state: 'off', port, code: null, owner: null });
  let servers: { http: ServerState; https: ServerState } = {
    http: off(deps.settings.get().httpPort),
    https: off(deps.settings.get().httpsPort),
  };
  const proxy = createDomainsProxy({
    table: () => table,
    logger: deps.logger,
    ...(deps.hosts ? { hosts: deps.hosts } : {}),
  });
  let timer: NodeJS.Timeout | null = null;
  let poll: NodeJS.Timeout | null = null;
  /** restart() and stop() run one at a time, in call order, on this chain. */
  let chain: Promise<void> = Promise.resolve();
  /** Set by stop() (quit): nothing binds or re-arms a timer afterwards, until start() is called again. */
  let stopped = false;
  const serial = (fn: () => Promise<void>): Promise<void> => {
    const run = chain.then(fn);
    chain = run.catch(() => undefined);
    return run;
  };
  /** The newly made root whose trust state was already set back to none (once per root, not per restart). */
  let ackedRoot: string | null = null;

  // Only names in the current table get a certificate: any web page can make the browser ask for
  // https://<anything>.localhost, and NestBox must not mint a leaf for each.
  const sni: SniResolver = (servername) => {
    const name = servername.toLowerCase();
    if (!table.byName.has(name)) return Promise.reject(new Error('unknown name'));
    return deps.ca.leaf(name);
  };

  /** A write NestBox makes on its own: a read-only store must not break the route table or the servers. */
  function housekeeping(fn: (s: DomainsSettings) => DomainsSettings): void {
    try {
      deps.settings.update(fn);
    } catch {
      deps.logger.warn('domains settings not saved');
    }
  }

  /** The root; a newly made one sets the trust state back to none (the store holds the old root, if any). */
  async function currentRoot() {
    const root = await deps.ca.root();
    if (deps.ca.regenerated() && ackedRoot !== root.sha1) {
      ackedRoot = root.sha1;
      if (deps.settings.get().trust !== 'none') {
        housekeeping((x) => ({ ...x, trust: 'none' }));
        deps.logger.info('domains trust reset', { reason: 'new-root' });
      }
    }
    return root;
  }

  /** Rebuilds the table; emits (and answers true) only when the routes or clashes changed. */
  async function rebuild(): Promise<boolean> {
    dirty = false;
    const settings = deps.settings.get();
    const projects = await deps.projects();
    // Overrides of removed projects are dropped here (no hook into project removal needed). Only the root
    // decides: a project whose folder is missing lists no workspaces, and their overrides must survive.
    const roots = new Set(projects.map((p) => p.id));
    const kept = (id: string) => roots.has(splitProjectId(id).rootId);
    const stale = [...Object.keys(settings.names), ...Object.keys(settings.rewriteHost)].filter(
      (id) => !kept(id),
    );
    if (stale.length > 0)
      housekeeping((s) => ({
        ...s,
        names: Object.fromEntries(Object.entries(s.names).filter(([id]) => kept(id))),
        rewriteHost: Object.fromEntries(Object.entries(s.rewriteHost).filter(([id]) => kept(id))),
      }));
    const processes = deps.processes();
    const ports =
      settings.enabled && processes.some((p) => isLive(p.state)) ? (await deps.ports()).rows : [];
    const mainScripts = new Map<string, string>();
    const detectedPorts = new Map<string, number>();
    for (const p of projects)
      for (const pkg of [{ id: p.id, path: p.path }, ...p.workspaces]) {
        let main: string | null = null;
        try {
          main = deps.mainScript(pkg.id);
        } catch {
          // removed while rebuilding: no main command
        }
        if (main) mainScripts.set(pkg.id, main);
        const detected = await deps.detectedPort(pkg.id, pkg.path).catch(() => null);
        if (detected !== null) detectedPorts.set(pkg.id, detected);
      }
    const current = deps.settings.get();
    table = buildRoutes({
      projects,
      overrides: current.names,
      rewriteHost: current.rewriteHost,
      mainScripts,
      processes,
      ports,
      detectedPorts,
      ownPorts: [current.httpPort, current.httpsPort],
    });
    const key = JSON.stringify([table.routes, table.clashes]);
    if (key === shown) return false;
    shown = key;
    deps.emit();
    return true;
  }

  async function ownerOf(state: ServerState): Promise<ServerState> {
    if (state.code !== 'EADDRINUSE') return state;
    const row = (await deps.ports().catch(() => null))?.rows.find((r) => r.port === state.port);
    const owner = row?.owner
      ? `${row.owner.projectId} · ${row.owner.script}`
      : (row?.processName ?? null);
    return { ...state, owner };
  }

  const wanted = () => !stopped && deps.settings.get().enabled;

  async function shutDown(): Promise<void> {
    if (poll) clearInterval(poll);
    poll = null;
    await proxy.stop();
    const s = deps.settings.get();
    servers = { http: off(s.httpPort), https: off(s.httpsPort) };
  }

  /** Brings the servers in line with the settings. Always through serial(); re-checks after each await. */
  async function applySettings(): Promise<void> {
    if (!wanted()) {
      await shutDown();
      if (!stopped) deps.emit();
      return;
    }
    // Load (or make) the root first, so a new one resets the trust state before anyone asks.
    await currentRoot().catch(() => deps.logger.warn('domains ca unavailable'));
    if (!wanted()) return shutDown();
    const s = deps.settings.get();
    const started = await proxy.start({ httpPort: s.httpPort, httpsPort: s.httpsPort, sni });
    if (!wanted()) return shutDown();
    const next = { http: await ownerOf(started.http), https: await ownerOf(started.https) };
    if (!wanted()) return shutDown();
    servers = next;
    poll ??= setInterval(() => {
      if (deps.processes().some((p) => isLive(p.state))) void rebuild().catch(() => undefined);
    }, POLL_MS);
    // The servers changed even when the routes didn't.
    if (!(await rebuild())) deps.emit();
  }

  const restart = () => serial(applySettings);

  function status(): DomainsStatus {
    const s = deps.settings.get();
    return {
      enabled: s.enabled,
      http: servers.http,
      https: servers.https,
      trust: s.trust,
      routes: table.routes,
      clashes: table.clashes,
    };
  }

  async function knownId(projectId: string): Promise<void> {
    const projects = await deps.projects();
    if (!projects.some((p) => p.id === projectId || p.workspaces.some((w) => w.id === projectId)))
      throw new NestboxError('NOT_FOUND', 'Project not found');
  }

  return {
    async status() {
      if (table === EMPTY || dirty) await rebuild();
      return status();
    },
    async setEnabled(enabled) {
      deps.settings.update((s) => ({ ...s, enabled }));
      await restart();
      deps.logger.info('domains toggled', { enabled });
      return status();
    },
    async setPorts({ httpPort, httpsPort }) {
      deps.settings.update((s) => ({ ...s, httpPort, httpsPort }));
      await restart();
      return status();
    },
    async setName({ projectId, label }) {
      await knownId(projectId);
      deps.settings.update((s) => {
        const names = Object.fromEntries(
          Object.entries(s.names).filter(([id]) => id !== projectId),
        );
        if (label !== null) names[projectId] = label;
        return { ...s, names };
      });
      await rebuild();
      return status();
    },
    async setRewriteHost({ projectId, rewrite }) {
      await knownId(projectId);
      deps.settings.update((s) => {
        const rewriteHost: Record<string, true> = Object.fromEntries(
          Object.entries(s.rewriteHost).filter(([id]) => id !== projectId),
        );
        if (rewrite) rewriteHost[projectId] = true;
        return { ...s, rewriteHost };
      });
      await rebuild();
      return status();
    },
    async trustCa() {
      if (!(await deps.confirm('trust'))) return { result: 'cancelled' };
      const file = join(tmpdir(), `nestbox-ca-${randomUUID()}.crt`);
      let result: 'trusted' | 'cancelled' | 'failed';
      try {
        await writeFile(file, (await currentRoot()).cert);
        result = await deps.trust.trust(file);
      } catch (error) {
        // A missing certutil/security (ENOENT) or an unwritable temp folder: a failure, never a rejection.
        result = 'failed';
        deps.logger.warn('domains trust failed', { code: errorCode(error) });
      } finally {
        await rm(file, { force: true }).catch(() => undefined);
      }
      deps.settings.update((s) => ({
        ...s,
        trust: result === 'trusted' ? 'trusted' : 'untrusted',
      }));
      deps.logger.info('domains trust', { result });
      deps.emit();
      return { result };
    },
    async removeCa() {
      if (!(await deps.confirm('remove'))) return { result: 'cancelled' };
      let result: 'removed' | 'failed';
      try {
        // currentRoot() first: a root made just now (the file was lost) sets trust to none, and the old
        // root's ids are gone, so there is nothing to untrust.
        const root = deps.settings.get().trust === 'none' ? null : await currentRoot();
        const trust = deps.settings.get().trust;
        if (root && trust === 'trusted') result = await deps.trust.untrust(root);
        else {
          // Untrusted: declined or failed, so most likely never added. Best effort; the reset goes ahead.
          if (root && trust === 'untrusted') await deps.trust.untrust(root).catch(() => 'failed');
          result = 'removed';
        }
        if (result === 'removed') {
          await deps.ca.reset();
          ackedRoot = null;
          deps.settings.update((s) => ({ ...s, trust: 'none' }));
        }
      } catch (error) {
        result = 'failed';
        deps.logger.warn('domains untrust failed', { code: errorCode(error) });
      }
      // A fresh SNI cache, so no leaf of the old root is served again.
      if (result === 'removed' && deps.settings.get().enabled)
        await restart().catch(() => deps.logger.warn('domains restart failed'));
      deps.logger.info('domains ca removed', { result });
      deps.emit();
      return { result };
    },
    refresh() {
      if (stopped) return;
      if (!deps.settings.get().enabled) {
        dirty = true;
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void rebuild().catch(() => undefined), REBUILD_MS);
    },
    start() {
      stopped = false;
      return restart();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await serial(shutDown);
    },
  };
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}
