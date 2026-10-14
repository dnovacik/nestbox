import type { z } from 'zod';
import type { DepRow, DepType, PackageResult, StepError } from '@shared/tools/deps/contract';
import type { PlatformAdapter } from '../platform/adapter';

export type EcosystemId = 'python' | 'dotnet' | 'node';

export interface DetectedTask {
  /** Unique identifier within the package (e.g. 'run', 'test', 'uvicorn'). */
  name: string;
  /** Command line as argv (no shell). */
  argv: string[];
  /** Human-readable title shown in the UI. */
  title: string;
}

export interface RunEnv {
  /** Directory to prepend to PATH. */
  pathPrepend?: string;
  /** Environment variables to set. */
  env?: Record<string, string>;
  /** Optional note shown in the log (e.g. "Using .venv"). */
  note?: string;
  /** A version mismatch or missing tool: logged first and shown on the row (like the Node tool's). */
  warning?: string;
}

/** Runs one command to completion for a dependency check (the Dependencies tool's runner). */
export type DepsRun = (
  command: string,
  args: string[],
  env?: Record<string, string>,
) => Promise<{ code: number | null; stdout: string; timedOut: boolean }>;

/** One package's dependency check result. */
export interface EcosystemDeps {
  manager: PackageResult['manager'];
  rows: DepRow[];
  errors: StepError[];
}

/** What detect() knows beyond the folder itself. */
export interface DetectContext {
  /** The project root's file and folder names when the folder is a workspace package; null for the root. */
  root: { path: string; files: ReadonlySet<string>; dirs: ReadonlySet<string> } | null;
  /** A file of the folder (its name relative to the folder) that couldn't be used, and why. Never its contents. */
  onWarning?(file: string, reason: 'unreadable' | 'invalid-json' | 'not-an-object'): void;
}

/** Warnings a module may raise while reading the root's workspace config: file names and a reason only. */
export interface WorkspaceContext {
  onWarning?(file: string, reason: 'invalid-yaml'): void;
}

export interface RunEnvContext<Settings = unknown> {
  dir: string;
  /** The project root's folder when dir is a workspace package (inherited config); null or absent for a root. */
  rootDir?: string | null;
  platform: PlatformAdapter;
  settings: Settings;
  /** The detected task being started (absent for npm scripts and custom commands). */
  task?: string;
}

/** Dependencies a package needs installed first: none yet, or older than the lockfile; and the task that installs. */
export interface InstallHint {
  state: 'missing' | 'stale';
  task: string;
}

export interface EcosystemModule<Info, Settings = unknown> {
  id: EcosystemId;

  /** Zod schema for validating detected info. */
  infoSchema: z.ZodSchema<Info>;

  /** Pure filesystem detection of one folder. No Electron, no subprocess. */
  detect(
    dir: string,
    files: ReadonlySet<string>,
    dirs: ReadonlySet<string>,
    ctx?: DetectContext,
  ): Promise<Info | null>;

  /**
   * Files that make a sub-folder a package when the root declares no workspaces (multi-folder projects):
   * the folder holding a match is the package, one or two levels down (like Node's package.json).
   */
  packageGlobs: string[];

  /** Optional: a folder name that never holds one of this ecosystem's packages (build output, tests). */
  skipDir?(name: string): boolean;

  /**
   * Optional: package folders the root lists itself (a .NET solution's projects), relative with `/`.
   * Added to the workspaces or sub-folder packages; may name folders that don't exist or leave the root
   * (both are dropped). Small capped reads only.
   */
  workspaceDirs?(root: string): Promise<string[]>;

  /**
   * Optional: the package folders the root's own workspace config declares (npm/pnpm/yarn workspaces),
   * relative with `/`; null when it declares none. When any module returns a list, sub-folder discovery
   * (packageGlobs) is skipped. The module reads its own files (small reads); folders outside the root are
   * dropped afterwards.
   */
  declaredWorkspaces?(root: string, ctx?: WorkspaceContext): Promise<string[] | null>;

  /**
   * Optional: the Dependencies tool's check of one package folder (network: only on Check or the
   * schedule). run executes in dir. null when the folder has nothing of its own to check. A folder in
   * several ecosystems gets one result: the tool tries Node first, then the rest in order.
   */
  deps?(info: Info, run: DepsRun, dir: string): Promise<EcosystemDeps | null>;

  /** Optional: "Copy update command" for a row; null when the row's manager isn't this module's. */
  depsUpdateCommand?(name: string, row: { manager: PackageResult['manager']; type: DepType | null }): string | null;

  /**
   * Optional: whether the package's dependencies need installing (stat calls only); null when they're fine or
   * there is nothing to install. The Scripts tab offers the task.
   */
  installHint?(ctx: { dir: string; rootDir: string | null }, info: Info): Promise<InstallHint | null>;

  /** Optional: local http ports the package listens on when it runs (Health suggestions). */
  ports?(info: Info): number[];

  /** Commands the ecosystem offers without the user typing them. */
  tasks(info: Info): DetectedTask[];

  /** How a command of this package runs: PATH entry, env, note. */
  runEnv(ctx: RunEnvContext<Settings>, info: Info): Promise<RunEnv>;

  /** Optional: one-line summary for project-info (e.g. "Python 3.12 · uv · .venv"). */
  summary?(info: Info): string | null;

  // Optional providers for later phases:
  // version?(ctx: RunEnvContext<Settings>, info: Info): Promise<string | null>;
}

export interface EcosystemEntry {
  id: EcosystemId;
  info: unknown;
  summary?: string | null;
}
