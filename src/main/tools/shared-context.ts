export interface SharedFacts {
  get(key: string): unknown;
  publish(key: string, value: unknown): void;
}

export interface SharedContext {
  forProject(projectId: string): SharedFacts;
  clearProject(projectId: string): void;
}

export function createSharedContext(): SharedContext {
  const facts = new Map<string, Map<string, unknown>>();
  return {
    forProject(projectId) {
      return {
        get: (key) => facts.get(projectId)?.get(key),
        publish: (key, value) => {
          const bucket = facts.get(projectId) ?? new Map<string, unknown>();
          bucket.set(key, value);
          facts.set(projectId, bucket);
        },
      };
    },
    clearProject(projectId) {
      // The project and its workspace packages (`<rootId>::<relPath>`).
      for (const id of [...facts.keys()]) if (id === projectId || id.startsWith(`${projectId}::`)) facts.delete(id);
    },
  };
}
