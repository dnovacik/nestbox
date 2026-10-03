import { notImplemented, type PlatformAdapter, type PlatformDeps } from './adapter';
import { normalizeDarwinPath } from './paths';

/** macOS stub until the v2 macOS phase. Only path comparison and window chrome are real. */
export function createDarwinAdapter(_deps: PlatformDeps): PlatformAdapter {
  return {
    id: 'darwin',
    listListeningPorts: async () => notImplemented('listListeningPorts'),
    describeProcesses: async () => notImplemented('describeProcesses'),
    killTree: async () => notImplemented('killTree'),
    listProcesses: async () => notImplemented('listProcesses'),
    spawnScript: () => notImplemented('spawnScript'),
    spawnCommand: () => notImplemented('spawnCommand'),
    execCommand: async () => notImplemented('execCommand'),
    openTerminal: async () => notImplemented('openTerminal'),
    openInEditor: async () => notImplemented('openInEditor'),
    resolveShellEnv: async () => notImplemented('resolveShellEnv'),
    normalizePath: normalizeDarwinPath,
    samePath: (a, b) => normalizeDarwinPath(a) === normalizeDarwinPath(b),
    windowChrome: () => ({ titleBarStyle: 'hiddenInset' }),
    notificationAppId: () => null,
    commandExists: async () => null,
  };
}
