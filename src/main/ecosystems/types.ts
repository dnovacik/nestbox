import type { z } from 'zod';
import type { PlatformAdapter } from '../platform/types';

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

  /** Globs that make a sub-folder a package (multi-folder projects). */
  packageGlobs: string[];

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
