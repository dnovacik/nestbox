import { NestboxError } from '@shared/errors';
import { isLive, type ProcessSummary } from '@shared/processes';
import type { PortKillInput, PortKillResult, PortList, PortRow } from '@shared/ports';
import type { Logger } from '../logger';
import type { PlatformAdapter } from '../platform/adapter';
import { AttributionCache } from './attribution';

/** Scans closer together than this share one result (several Overview cards poll at once). */
export const SCAN_CACHE_MS = 1_000;
const FREE_POLL_MS = 500;
/** System Idle and System. */
const PROTECTED_PIDS = new Set([0, 4]);

export interface PortServiceDeps {
  platform: Pick<PlatformAdapter, 'listListeningPorts' | 'describeProcesses' | 'listProcesses' | 'killTree'>;
  processes: { list(): ProcessSummary[]; stop(projectId: string, script: string): Promise<unknown> };
  /** NestBox's own main process, which may never be killed from here. */
  ownPid: number;
  now(): number;
  logger: Logger;
}

/** The machine's listening TCP ports, attributed to NestBox scripts, and the rules for freeing one. */
export class PortService {
  private readonly attribution: AttributionCache;
  private last: PortList | null = null;
  private inflight: Promise<PortList> | null = null;

  constructor(private readonly deps: PortServiceDeps) {
    this.attribution = new AttributionCache({
      listProcesses: () => deps.platform.listProcesses(),
      describe: (pids) => deps.platform.describeProcesses(pids),
    });
  }

  /** The cached scan when it is under a second old, otherwise a new one. A failed scan returns the last rows as stale. */
  list(): Promise<PortList> {
    if (this.last && !this.last.stale && this.deps.now() - this.last.scannedAt < SCAN_CACHE_MS) {
      return Promise.resolve(this.last);
    }
    return this.scan();
  }

  async kill(input: PortKillInput): Promise<PortKillResult> {
    if (PROTECTED_PIDS.has(input.pid) || input.pid === this.deps.ownPid) {
      throw new NestboxError('FORBIDDEN', 'This process cannot be stopped from NestBox');
    }
    // Always a fresh scan: the PID must be listening on that port right now (stale rows may name a reused PID).
    const { rows, stale } = await this.scan();
    if (stale) throw new NestboxError('INTERNAL', 'Could not list ports');
    const row = rows.find((r) => r.pid === input.pid && r.port === input.port);
    if (!row) throw new NestboxError('NOT_FOUND', 'Nothing with that process id is listening on that port');
    if (row.owner) {
      this.deps.logger.info('ports kill', { port: row.port, owned: true });
      await this.deps.processes.stop(row.owner.projectId, row.owner.script);
      this.invalidate();
      return { result: 'stopped-script', processName: row.processName };
    }
    if (!input.confirmed) return { result: 'needs-confirm', processName: row.processName };
    // taskkill /T kills the whole tree: refuse when NestBox itself is in it (e.g. the dev server that started it).
    if (await this.isAncestorOfSelf(row.pid)) {
      throw new NestboxError('FORBIDDEN', 'Stopping this process would also close NestBox');
    }
    this.deps.logger.info('ports kill', { port: row.port, owned: false });
    await this.deps.platform.killTree(row.pid);
    this.invalidate();
    return { result: 'killed', processName: row.processName };
  }

  /** Polls until nothing listens on port. False after timeoutMs. */
  async waitUntilFree(port: number, timeoutMs: number): Promise<boolean> {
    const until = this.deps.now() + timeoutMs;
    for (;;) {
      const result = await this.scan().catch(() => null);
      if (result && !result.stale && !result.rows.some((r) => r.port === port)) return true;
      if (this.deps.now() + FREE_POLL_MS > until) return false;
      await new Promise((resolve) => setTimeout(resolve, FREE_POLL_MS));
    }
  }

  private async isAncestorOfSelf(pid: number): Promise<boolean> {
    const table = await this.deps.platform.listProcesses().catch(() => null);
    if (!table) return false;
    const parents = new Map(table.map((p) => [p.pid, p.parentPid]));
    let current = parents.get(this.deps.ownPid);
    for (let hop = 0; current !== undefined && current !== 0 && hop < 32; hop++) {
      if (current === pid) return true;
      current = parents.get(current);
    }
    return false;
  }

  private invalidate(): void {
    if (this.last) this.last = { ...this.last, scannedAt: 0 };
  }

  private scan(): Promise<PortList> {
    if (this.inflight) return this.inflight;
    const run = this.doScan().finally(() => {
      this.inflight = null;
    });
    this.inflight = run;
    return run;
  }

  private async doScan(): Promise<PortList> {
    let entries;
    try {
      entries = await this.deps.platform.listListeningPorts();
    } catch (error) {
      if (this.last) return { ...this.last, stale: true };
      throw error instanceof NestboxError ? error : new NestboxError('INTERNAL', 'Could not list ports');
    }
    const owners = new Map<number, { projectId: string; script: string }>();
    for (const p of this.deps.processes.list()) {
      if (p.pid !== null && isLive(p.state)) owners.set(p.pid, { projectId: p.projectId, script: p.script });
    }
    await this.attribution.refresh(
      entries.map((e) => e.pid),
      new Set(owners.keys()),
    );
    const rows: PortRow[] = entries.map((e) => {
      const root = this.attribution.ownerRoot(e.pid);
      return {
        port: e.port,
        pid: e.pid,
        addresses: e.addresses,
        processName: e.processName,
        command: this.attribution.command(e.pid),
        // A script that stopped while its server kept listening no longer owns the port.
        owner: root === null ? null : (owners.get(root) ?? null),
      };
    });
    this.last = { rows, scannedAt: this.deps.now(), stale: false };
    return this.last;
  }
}
