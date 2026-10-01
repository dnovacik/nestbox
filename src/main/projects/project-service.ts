import { type DetectedProject, findDetected, type ProjectSummary, splitProjectId } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { type Project, ProjectSchema } from '@shared/types';
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
      detected,
    };
  }
}
