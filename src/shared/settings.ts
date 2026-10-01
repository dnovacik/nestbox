import { z } from 'zod';
import { AppSettingsSchema, TRAY_ICON_THEMES } from './types';

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
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const SettingsViewSchema = AppSettingsSchema.extend({ readOnly: z.boolean() });
export type SettingsView = z.infer<typeof SettingsViewSchema>;
