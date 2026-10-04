import { z } from 'zod';
import { TOGGLEABLE_TOOLS } from './tools';
import { AppSettingsSchema, DEPS_SCHEDULES, THEMES, TERMINAL_APPS, TRAY_ICON_THEMES, WatchedPortsSchema } from './types';

/** Editor command as the user types it. Rejects what cannot pass safely through cmd.exe (see assertCmdSafe). */
export const EditorCommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(260)
  .refine((v) => !/["\r\n\0]/.test(v), { message: 'unsafe-character' });

export const LogBufferLinesSchema = z.number().int().min(1_000).max(1_000_000);

/** The settings the Settings dialog may change. Strict: anything else is a VALIDATION error. */
export const SettingsPatchSchema = z.strictObject({
  closeToTray: z.boolean().optional(),
  trayIconTheme: z.enum(TRAY_ICON_THEMES).optional(),
  logBufferLines: LogBufferLinesSchema.optional(),
  editorCommand: EditorCommandSchema.optional(),
  watchedPorts: WatchedPortsSchema.optional(),
  terminalApp: z.enum(TERMINAL_APPS).optional(),
  depsSchedule: z.enum(DEPS_SCHEDULES).optional(),
  theme: z.enum(THEMES).optional(),
  /** Only tools that can be turned off; the core stays on. */
  disabledTools: z
    .array(z.string().refine((id) => TOGGLEABLE_TOOLS.some((t) => t.id === id), 'not-toggleable'))
    .max(64)
    .optional(),
  /** Set once, by the first-run picker. */
  toolsChosen: z.literal(true).optional(),
});

/** "3000, 5173" → [3000, 5173] (duplicates dropped, order kept); null when any entry is not a valid port. */
export function parsePortList(text: string): number[] | null {
  const parts = text.split(',').map((p) => p.trim()).filter((p) => p !== '');
  const ports: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,5}$/.test(part)) return null;
    const port = Number(part);
    if (port < 1 || port > 65_535) return null;
    if (!ports.includes(port)) ports.push(port);
  }
  return WatchedPortsSchema.safeParse(ports).success ? ports : null;
}
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const SettingsViewSchema = AppSettingsSchema.extend({ readOnly: z.boolean() });
export type SettingsView = z.infer<typeof SettingsViewSchema>;
