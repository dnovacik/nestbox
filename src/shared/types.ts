import { z } from 'zod';

export const ProjectNameSchema = z.string().trim().min(1).max(100);

export const RunGroupEntrySchema = z.object({
  /** '' = the root package; otherwise the workspace package's posix relPath. */
  relPath: z.string(),
  script: z.string().min(1).max(200),
});
export type RunGroupEntry = z.infer<typeof RunGroupEntrySchema>;

/** A Compose service name as NestBox accepts it on a command line. */
export const SERVICE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

export const RunGroupComposeSchema = z.object({
  /** '' = the root package; otherwise the workspace package's posix relPath. */
  relPath: z.string(),
  /** Empty = the whole stack. */
  services: z.array(z.string().regex(SERVICE_NAME)).max(50),
});
export type RunGroupCompose = z.infer<typeof RunGroupComposeSchema>;

export const RunGroupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  entries: z.array(RunGroupEntrySchema).max(50),
  /** Compose services brought up (and waited for) before the scripts start. */
  compose: z.array(RunGroupComposeSchema).max(20).default([]),
});
export type RunGroup = z.infer<typeof RunGroupSchema>;

export const TRAY_ICON_THEMES = ['auto', 'dark-taskbar', 'light-taskbar'] as const;
export type TrayIconTheme = (typeof TRAY_ICON_THEMES)[number];

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: ProjectNameSchema,
  /** Absolute path with its original casing. Never normalised for storage. */
  path: z.string().min(1),
  tags: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
  /** Live on the root project; entries may name workspace packages. */
  runGroups: z.array(RunGroupSchema).default([]),
  envProfiles: z.array(z.object({ name: z.string().min(1), file: z.string().min(1) })).default([]),
  staticServer: z
    .object({
      folder: z.string(),
      port: z.number().int().min(1).max(65535),
      spa: z.boolean(),
      https: z.boolean(),
    })
    .optional(),
  /** Per tool id, owned and validated by the tool. */
  toolSettings: z.record(z.string(), z.unknown()).default({}),
});
export type Project = z.infer<typeof ProjectSchema>;

/** Up to 20 distinct TCP ports, shown on each project's Overview (free or in use). */
export const WatchedPortsSchema = z
  .array(z.number().int().min(1).max(65_535))
  .max(20)
  .refine((ports) => new Set(ports).size === ports.length, { message: 'duplicate-port' });
export const DEFAULT_WATCHED_PORTS = [3000, 5173, 5432, 6379, 8080];

export const AppSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  editorCommand: z.string().min(1).default('code'),
  /** 'auto' lets the platform adapter pick (wt with cmd fallback on Windows). */
  terminalApp: z.string().min(1).default('auto'),
  logBufferLines: z.number().int().min(1_000).max(1_000_000).default(50_000),
  closeToTray: z.boolean().default(true),
  /** Which tray icon set to use; 'auto' follows nativeTheme. Windows' taskbar is dark by default. */
  trayIconTheme: z.enum(TRAY_ICON_THEMES).default('dark-taskbar'),
  /** Added in M2 with a default, so stores written before it need no migration. */
  watchedPorts: WatchedPortsSchema.default(() => [...DEFAULT_WATCHED_PORTS]),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const CURRENT_SCHEMA_VERSION = 2;

export const StoreDataSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  settings: AppSettingsSchema,
  projects: z.array(ProjectSchema),
});
export type StoreData = z.infer<typeof StoreDataSchema>;

export function defaultStoreData(): StoreData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, settings: AppSettingsSchema.parse({}), projects: [] };
}

export const PLATFORM_IDS = ['win32', 'darwin'] as const;

/** The terminal setting. 'auto' lets the platform pick; the others name one app (each platform offers its own). */
export const TERMINAL_APPS = ['auto', 'windows-terminal', 'cmd', 'terminal', 'iterm', 'ghostty'] as const;
export type TerminalApp = (typeof TERMINAL_APPS)[number];
export const TERMINALS_BY_PLATFORM = {
  win32: ['auto', 'windows-terminal', 'cmd'],
  darwin: ['auto', 'terminal', 'iterm', 'ghostty'],
} as const satisfies Record<(typeof PLATFORM_IDS)[number], readonly TerminalApp[]>;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const AppInfoSchema = z.object({
  version: z.string(),
  platform: z.enum(PLATFORM_IDS),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;
