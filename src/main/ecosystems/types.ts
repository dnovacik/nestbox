import type { z } from 'zod';
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

export interface RunEnvContext<Settings = unknown> {
  dir: string;
  platform: PlatformAdapter;
  settings: Settings;
}

export interface EcosystemModule<Info, Settings = unknown> {
  id: EcosystemId;

  /** Zod schema for validating detected info. */
  infoSchema: z.ZodSchema<Info>;

  /** Pure filesystem detection of one folder. No Electron, no subprocess. */
  detect(dir: string, files: ReadonlySet<string>, dirs: ReadonlySet<string>): Promise<Info | null>;

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
  // deps?(ctx: RunEnvContext<Settings>, info: Info): Promise<DepsResult>;
}

export interface EcosystemEntry {
  id: EcosystemId;
  info: unknown;
}
