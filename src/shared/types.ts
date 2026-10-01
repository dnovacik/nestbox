import { z } from 'zod';

export const ProjectNameSchema = z.string().trim().min(1).max(100);

export const RunGroupEntrySchema = z.object({
  /** '' = the root package; otherwise the workspace package's posix relPath. */
  relPath: z.string(),
  script: z.string().min(1).max(200),
});
export type RunGroupEntry = z.infer<typeof RunGroupEntrySchema>;

export const RunGroupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  entries: z.array(RunGroupEntrySchema).max(50),
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

export const AppSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  editorCommand: z.string().min(1).default('code'),
  /** 'auto' lets the platform adapter pick (wt with cmd fallback on Windows). */
  terminalApp: z.string().min(1).default('auto'),
  logBufferLines: z.number().int().min(1_000).max(1_000_000).default(50_000),
  closeToTray: z.boolean().default(true),
  /** Which tray icon set to use; 'auto' follows nativeTheme. Windows' taskbar is dark by default. */
  trayIconTheme: z.enum(TRAY_ICON_THEMES).default('dark-taskbar'),
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
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const AppInfoSchema = z.object({
  version: z.string(),
  platform: z.enum(PLATFORM_IDS),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;
