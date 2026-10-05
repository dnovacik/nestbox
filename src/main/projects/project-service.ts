import { type DetectedProject, findDetected, type ProjectSummary, splitProjectId } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { type Project, type ProjectGroup, ProjectSchema, type RunGroup, RunGroupSchema } from '@shared/types';
import type { DetectInput } from '../detection/detect-project';
import type { Logger } from '../logger';
import type { StoreService } from '../store/store-service';

export interface ProjectServiceDeps {
  store: StoreService;
  samePath(a: string, b: string): boolean;
  /** Makes a picked path absolute without changing its casing (path.resolve in production). */
  resolvePath(p: string): string;
  isDirectory(p: string): Promise<boolean>;
  detect(input: DetectInput): Promise<DetectedProject>;
  newId(): string;
  onChanged(): void;
  logger: Logger;
}

const MAX_NAME_LENGTH = 100;

/** Stored name: trimmed, the path itself when nothing usable was detected (for example a drive root), capped at 100 characters. */
export function displayName(detectedName: string, path: string): string {
  const name = detectedName.trim() || path;
  return name.slice(0, MAX_NAME_LENGTH);
}

/** How long a tool call waits for a project that is still being detected. */
export const DETECTION_WAIT_MS = 15_000;

export class ProjectService {
  /** Detection results by root project id. In memory only — never persisted. */
  private readonly detected = new Map<string, DetectedProject>();

  constructor(private readonly deps: ProjectServiceDeps) {}

  /** Detections in progress by root id; list() and refresh() join them instead of starting another. */
  private readonly inflight = new Map<string, Promise<DetectedProject>>();

  /**
   * Starts detecting every stored project in the background. Never rejects: a failure is logged by
   * project id and that project is detected again on the next list(). Callers need not await it.
   */
  async init(): Promise<void> {
    const projects = [...this.deps.store.getProjects()];
    const results = await Promise.allSettled(projects.map((p) => this.detectAndCache(p)));
    results.forEach((result, i) => {
      if (result.status === 'rejected') this.deps.logger.warn('detection failed', { projectId: projects[i]?.id ?? null });
    });
  }

  async list(): Promise<ProjectSummary[]> {
    return Promise.all(
      this.deps.store
        .getProjects()
        .map(async (p) => this.toSummary(p, this.detected.get(p.id) ?? (await this.detectAndCache(p)))),
    );
  }

  async add(rawPath: string): Promise<ProjectSummary> {
    const path = this.deps.resolvePath(rawPath);
    if (!(await this.deps.isDirectory(path))) {
      throw new NestboxError('VALIDATION', 'The selected folder does not exist');
    }
    this.assertNotDuplicate(path);
    const id = this.deps.newId();
    const detected = await this.deps.detect({ id, path });
    // Re-check synchronously: another add may have won the race while detect was awaiting.
    this.assertNotDuplicate(path);
    const project = ProjectSchema.parse({ id, name: displayName(detected.name, path), path });
    this.deps.store.updateProjects((ps) => [...ps, project]);
    this.detected.set(id, detected);
    this.deps.onChanged();
    return this.toSummary(project, detected);
  }

  remove(id: string): void {
    const project = this.requireRoot(id);
    this.deps.store.updateProjects((ps) => ps.filter((p) => p.id !== project.id));
    this.detected.delete(project.id);
    this.deps.onChanged();
  }

  rename(id: string, name: string): ProjectSummary {
    const { rootId, relPath } = splitProjectId(id);
    if (relPath !== '') {
      // A workspace package's name comes from its package.json: renaming stores an alias on the root.
      const root = this.requireRoot(rootId);
      this.getDetected(id);
      this.deps.store.updateProjects((ps) =>
        ps.map((p) => (p.id === root.id ? { ...p, aliases: { ...p.aliases, [relPath]: name } } : p)),
      );
      this.deps.onChanged();
      return this.summaryOf(root.id);
    }
    const project = this.requireRoot(id);
    this.deps.store.updateProjects((ps) => ps.map((p) => (p.id === project.id ? { ...p, name } : p)));
    const cached = this.detected.get(project.id);
    if (cached) this.detected.set(project.id, { ...cached, name });
    this.deps.onChanged();
    return this.summaryOf(project.id);
  }

  setPinned(id: string, pinned: boolean): ProjectSummary {
    const project = this.requireRoot(id);
    this.deps.store.updateProjects((ps) => ps.map((p) => (p.id === project.id ? { ...p, pinned } : p)));
    this.deps.onChanged();
    return this.summaryOf(project.id);
  }

  async refresh(id: string): Promise<ProjectSummary> {
    const project = this.requireRoot(splitProjectId(id).rootId);
    // A detection started before this refresh may predate the change the user is refreshing for.
    await this.inflight.get(project.id)?.catch(() => undefined);
    const detected = await this.detectAndCache(project);
    if (!this.deps.store.getProjects().some((p) => p.id === project.id)) {
      throw new NestboxError('NOT_FOUND', 'Project not found');
    }
    this.deps.onChanged();
    return this.toSummary(project, detected);
  }

  listGroups(): ProjectGroup[] {
    return [...this.deps.store.getGroups()];
  }

  createGroup(name: string): ProjectGroup {
    const group: ProjectGroup = { id: this.deps.newId(), name, collapsed: false };
    this.deps.store.updateLayout(({ projects, groups }) => ({ projects, groups: [...groups, group] }));
    this.deps.onChanged();
    return group;
  }

  renameGroup(id: string, name: string): ProjectGroup {
    this.requireGroup(id);
    this.deps.store.updateLayout(({ projects, groups }) => ({
      projects,
      groups: groups.map((g) => (g.id === id ? { ...g, name } : g)),
    }));
    this.deps.onChanged();
    return this.requireGroup(id);
  }

  setGroupCollapsed(id: string, collapsed: boolean): ProjectGroup {
    this.requireGroup(id);
    this.deps.store.updateLayout(({ projects, groups }) => ({
      projects,
      groups: groups.map((g) => (g.id === id ? { ...g, collapsed } : g)),
    }));
    this.deps.onChanged();
    return this.requireGroup(id);
  }

  /** Its projects stay, ungrouped. */
  deleteGroup(id: string): void {
    this.requireGroup(id);
    this.deps.store.updateLayout(({ projects, groups }) => ({
      projects: projects.map((p) => (p.groupId === id ? { ...p, groupId: null } : p)),
      groups: groups.filter((g) => g.id !== id),
    }));
    this.deps.onChanged();
  }

  /** Puts a group before another one, or last. */
  moveGroup(id: string, beforeId: string | null): void {
    const group = this.requireGroup(id);
    if (beforeId !== null) this.requireGroup(beforeId);
    if (beforeId === id) return;
    this.deps.store.updateLayout(({ projects, groups }) => {
      const rest = groups.filter((g) => g.id !== id);
      const at = beforeId === null ? rest.length : rest.findIndex((g) => g.id === beforeId);
      return { projects, groups: [...rest.slice(0, at), group, ...rest.slice(at)] };
    });
    this.deps.onChanged();
  }

  /** Puts a root project into a group (null = ungrouped), before a project of that group, or last in it. */
  moveProject(id: string, groupId: string | null, beforeId: string | null): void {
    const project = this.requireRoot(id);
    if (groupId !== null) this.requireGroup(groupId);
    if (beforeId === id) return;
    if (beforeId !== null) {
      const before = this.requireRoot(beforeId);
      if (before.groupId !== groupId) throw new NestboxError('VALIDATION', 'That project is in another group');
    }
    this.deps.store.updateLayout(({ projects, groups }) => {
      const moved = { ...project, groupId };
      const rest = projects.filter((p) => p.id !== id);
      let at: number;
      if (beforeId !== null) at = rest.findIndex((p) => p.id === beforeId);
      else {
        // Last in its group: after the last project already in it (or at the very end).
        const last = rest.map((p) => p.groupId).lastIndexOf(groupId);
        at = last === -1 ? rest.length : last + 1;
      }
      return { projects: [...rest.slice(0, at), moved, ...rest.slice(at)], groups };
    });
    this.deps.onChanged();
  }

  private requireGroup(id: string): ProjectGroup {
    const group = this.deps.store.getGroups().find((g) => g.id === id);
    if (!group) throw new NestboxError('NOT_FOUND', 'Group not found');
    return group;
  }

  getRunGroups(rootId: string): RunGroup[] {
    return this.requireRoot(rootId).runGroups;
  }

  /** Validates, persists and notifies. Run groups live on root projects only. */
  setRunGroups(rootId: string, groups: RunGroup[]): RunGroup[] {
    const project = this.requireRoot(rootId);
    const next = groups.map((g) => RunGroupSchema.parse(g));
    this.deps.store.updateProjects((ps) => ps.map((p) => (p.id === project.id ? { ...p, runGroups: next } : p)));
    this.deps.onChanged();
    return next;
  }

  getToolSettings(rootId: string, toolId: string): unknown {
    const settings = this.requireRoot(rootId).toolSettings;
    return Object.hasOwn(settings, toolId) ? settings[toolId] : undefined;
  }

  setToolSettings(rootId: string, toolId: string, value: unknown): void {
    const project = this.requireRoot(rootId);
    this.deps.store.updateProjects((ps) =>
      ps.map((p) => (p.id === project.id ? { ...p, toolSettings: { ...p.toolSettings, [toolId]: value } } : p)),
    );
  }

  /**
   * Like getDetected, but first waits (up to DETECTION_WAIT_MS) for a detection of the project that is
   * still running, e.g. at startup. Tool calls use this so they don't fail while the project loads.
   */
  async getDetectedAsync(projectId: string): Promise<DetectedProject> {
    const rootId = splitProjectId(projectId).rootId;
    const running = this.inflight.get(rootId);
    if (running && !this.detected.has(rootId)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<void>((resolve) => (timer = setTimeout(resolve, DETECTION_WAIT_MS)));
      await Promise.race([running.then(() => undefined, () => undefined), limit]);
      clearTimeout(timer);
    }
    return this.getDetected(projectId);
  }

  getDetected(projectId: string): DetectedProject {
    const root = this.detected.get(splitProjectId(projectId).rootId);
    const found = root ? findDetected(root, projectId) : null;
    if (!found) throw new NestboxError('NOT_FOUND', 'Project not found');
    return found;
  }

  private requireRoot(id: string): Project {
    if (splitProjectId(id).relPath !== '') {
      throw new NestboxError('VALIDATION', 'Workspace packages cannot be changed individually');
    }
    const project = this.deps.store.getProjects().find((p) => p.id === id);
    if (!project) throw new NestboxError('NOT_FOUND', 'Project not found');
    return project;
  }

  private summaryOf(id: string): ProjectSummary {
    const project = this.requireRoot(id);
    return this.toSummary(project, this.getDetected(id));
  }

  private detectAndCache(project: Project): Promise<DetectedProject> {
    const running = this.inflight.get(project.id);
    if (running) return running;
    const detection = this.deps
      .detect({ id: project.id, path: project.path, name: project.name })
      .then((detected) => {
        // The project may have been removed while detection was running.
        if (this.deps.store.getProjects().some((p) => p.id === project.id)) {
          this.detected.set(project.id, detected);
        }
        return detected;
      })
      .finally(() => this.inflight.delete(project.id));
    this.inflight.set(project.id, detection);
    return detection;
  }

  private assertNotDuplicate(path: string): void {
    const existing = this.deps.store.getProjects().find((p) => this.deps.samePath(p.path, path));
    if (existing) {
      throw new NestboxError('CONFLICT', `This folder is already added as "${existing.name}"`);
    }
  }

  private toSummary(project: Project, detected: DetectedProject): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      pinned: project.pinned,
      tags: project.tags,
      groupId: project.groupId,
      detected: {
        ...detected,
        workspaces: detected.workspaces.map((w) => {
          const alias = project.aliases[w.relPath];
          return alias === undefined ? w : { ...w, name: alias };
        }),
      },
    };
  }
}
