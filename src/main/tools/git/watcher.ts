import { join } from 'node:path';
import type { GitDirs } from '../../detection/git-head';

/** Watches a folder; returns a function that stops watching, or null when it can't watch. */
export type WatchFn = (dir: string, recursive: boolean, onChange: (fileName: string | null) => void) => (() => void) | null;

const QUIET_MS = 300;
const MIN_INTERVAL_MS = 1_000;

export interface GitWatcher {
  /** Starts watching a project's .git (once; again when its folders change). emit is replaced each call. */
  ensure(projectId: string, rootId: string, dirs: GitDirs, emit: () => void): void;
  forgetRoot(rootId: string): void;
  disposeAll(): void;
}

interface Entry {
  rootId: string;
  key: string;
  emit(): void;
  stop(): void;
}

/**
 * One watch of the gitdir (HEAD, index, MERGE_HEAD, FETCH_HEAD in a plain repo) and a recursive one of
 * the common dir's refs (branches, remotes, tags). Lock files come and go around every git write, so they
 * are ignored; the real file's rename follows them.
 */
export function createGitWatcher(watch: WatchFn): GitWatcher {
  const entries = new Map<string, Entry>();

  function start(rootId: string, dirs: GitDirs, emit: () => void): Entry | null {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastEmit = -Infinity;
    const entry: Entry = { rootId, key: `${dirs.gitDir}\0${dirs.commonDir}`, emit, stop: () => undefined };
    const fire = () => {
      const wait = lastEmit + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) {
        timer = setTimeout(fire, wait);
        return;
      }
      lastEmit = Date.now();
      entry.emit();
    };
    const onChange = (name: string | null) => {
      if (name?.endsWith('.lock')) return;
      clearTimeout(timer);
      timer = setTimeout(fire, QUIET_MS);
    };
    const stopGit = watch(dirs.gitDir, false, onChange);
    if (!stopGit) return null;
    // Optional: without it, commits still show up through the index and on window focus.
    const stopRefs = watch(join(dirs.commonDir, 'refs'), true, onChange);
    entry.stop = () => {
      clearTimeout(timer);
      stopGit();
      stopRefs?.();
    };
    return entry;
  }

  return {
    ensure(projectId, rootId, dirs, emit) {
      const existing = entries.get(projectId);
      if (existing && existing.key === `${dirs.gitDir}\0${dirs.commonDir}`) {
        existing.emit = emit;
        return;
      }
      existing?.stop();
      entries.delete(projectId);
      const entry = start(rootId, dirs, emit);
      // Couldn't watch (the folder may be gone): the next status call tries again.
      if (entry) entries.set(projectId, entry);
    },
    forgetRoot(rootId) {
      for (const [id, entry] of entries) {
        if (entry.rootId !== rootId) continue;
        entry.stop();
        entries.delete(id);
      }
    },
    disposeAll() {
      for (const entry of entries.values()) entry.stop();
      entries.clear();
    },
  };
}
