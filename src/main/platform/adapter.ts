import type { ChildProcess } from 'node:child_process';
import { NestboxError } from '@shared/errors';
import type { PlatformId } from '@shared/types';

export interface PortEntry {
  port: number;
  pid: number;
  processName: string;
  command: string | null;
}

export interface SpawnOpts {
  cwd: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface OverlayColors {
  color: string;
  symbolColor: string;
  height: number;
}

export interface WindowChrome {
  titleBarStyle: 'hidden' | 'hiddenInset';
  titleBarOverlay?: OverlayColors;
}

export interface ExecResult {
  /** null when the process was killed by the timeout or a signal. */
  code: number | null;
  /** Capped at 64 KiB. */
  stdout: string;
}

export interface PipedSpawnOpts {
  cwd: string;
  env: NodeJS.ProcessEnv;
  verbatim?: boolean;
}

export interface CommandRunner {
  /** Starts a detached process and resolves once it has spawned. Rejects (e.g. ENOENT) if it cannot start. */
  launch(file: string, args: readonly string[], opts?: { cwd?: string; verbatim?: boolean; hidden?: boolean }): Promise<void>;
  /** Runs to completion with a hidden window and no shell. Rejects only if it cannot start. */
  exec(file: string, args: readonly string[], opts?: { timeoutMs?: number }): Promise<ExecResult>;
  /** A long-running child with piped stdout/stderr, ignored stdin and a hidden window. */
  spawn(file: string, args: readonly string[], opts: PipedSpawnOpts): ChildProcess;
}

export interface PlatformDeps {
  runner: CommandRunner;
  getEditorCommand(): string;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  listListeningPorts(): Promise<PortEntry[]>;
  killTree(pid: number): Promise<void>;
  spawnScript(opts: SpawnOpts): ChildProcess;
  openTerminal(cwd: string, command?: string): Promise<void>;
  openInEditor(path: string, line?: number): Promise<void>;
  resolveShellEnv(): Promise<NodeJS.ProcessEnv>;
  /** Comparison key only — never store, display or pass to a command. */
  normalizePath(p: string): string;
  samePath(a: string, b: string): boolean;
  windowChrome(colors: OverlayColors): WindowChrome;
}

export function notImplemented(method: string): never {
  throw new NestboxError('NOT_IMPLEMENTED', `${method} is not implemented on this platform yet`);
}
