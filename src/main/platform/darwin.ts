import { notImplemented, type PlatformAdapter, type PlatformDeps } from './adapter';
import { normalizePosixPath } from './paths';

/** macOS stub until the v2 macOS phase. Only path comparison and window chrome are real. */
export function createDarwinAdapter(_deps: PlatformDeps): PlatformAdapter {
  return {
    id: 'darwin',
    listListeningPorts: async () => notImplemented('listListeningPorts'),
    killTree: async () => notImplemented('killTree'),
    spawnScript: () => notImplemented('spawnScript'),
    openTerminal: async () => notImplemented('openTerminal'),
    openInEditor: async () => notImplemented('openInEditor'),
    resolveShellEnv: async () => notImplemented('resolveShellEnv'),
    normalizePath: normalizePosixPath,
    samePath: (a, b) => normalizePosixPath(a) === normalizePosixPath(b),
    windowChrome: () => ({ titleBarStyle: 'hiddenInset' }),
  };
}
