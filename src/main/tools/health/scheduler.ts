// When each package's checks run: 2 s after one of its scripts starts (servers need a moment), then every
// interval, until no script of it runs. One run at a time per package; timers never keep the app alive.

export const START_DELAY_MS = 2_000;

export interface HealthScheduler {
  setLive(packageId: string, live: boolean): void;
  isLive(packageId: string): boolean;
  checkNow(packageId: string): Promise<void>;
  dispose(): void;
}

export function createHealthScheduler(deps: { run(packageId: string): Promise<void>; interval(packageId: string): number }): HealthScheduler {
  const live = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Map<string, Promise<void>>();

  function runOnce(id: string): Promise<void> {
    const existing = running.get(id);
    if (existing) return existing;
    const run = deps
      .run(id)
      .catch(() => undefined)
      .finally(() => running.delete(id));
    running.set(id, run);
    return run;
  }

  function schedule(id: string, delayMs: number): void {
    const timer = setTimeout(() => {
      void runOnce(id).then(() => {
        // Still live and not rescheduled meanwhile: wait one interval after this run.
        if (live.get(id) === timer) schedule(id, deps.interval(id) * 1000);
      });
    }, delayMs);
    timer.unref?.();
    live.set(id, timer);
  }

  return {
    setLive(id, isLive) {
      if (isLive === live.has(id)) return;
      if (isLive) schedule(id, START_DELAY_MS);
      else {
        clearTimeout(live.get(id));
        live.delete(id);
      }
    },
    isLive: (id) => live.has(id),
    checkNow: (id) => runOnce(id),
    dispose() {
      for (const timer of live.values()) clearTimeout(timer);
      live.clear();
    },
  };
}
