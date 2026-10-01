import { z } from 'zod';
import { LogLineSchema, LogSnapshotSchema } from '../../processes';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';

const settingsSchema = z.strictObject({});

export const claudeDefinition: ToolDefinition<z.infer<typeof settingsSchema>> = {
  id: 'claude',
  name: 'Claude Code',
  icon: 'sparkles',
  // Always: it is about readiness, so a project without Claude files still shows what is missing.
  appliesTo: () => true,
  settingsSchema,
};

export const CLAUDE_DOCS = ['CLAUDE.md', 'CLAUDE.local.md'] as const;
export const ClaudeDocSchema = z.enum(CLAUDE_DOCS);
export type ClaudeDoc = z.infer<typeof ClaudeDocSchema>;

export const MAX_DOC_BYTES = 1024 * 1024;
export const MAX_PROMPT_CHARS = 100_000;

const NamedEntrySchema = z.object({ name: z.string(), description: z.string().nullable() });

export const ClaudeFilesSchema = z.object({
  claudeMd: z.boolean(),
  claudeLocalMd: z.boolean(),
  commands: z.array(NamedEntrySchema),
  agents: z.array(NamedEntrySchema),
  skills: z.array(NamedEntrySchema),
  settings: z.array(
    z.object({ file: z.string(), allow: z.array(z.string()), deny: z.array(z.string()), ask: z.array(z.string()), hooks: z.array(z.string()) }),
  ),
  /** Name, type, command and argument count only: arguments, env and URL paths can hold tokens. */
  mcpServers: z.array(
    z.object({ name: z.string(), type: z.string(), command: z.string().nullable(), argCount: z.number().int(), url: z.string().nullable() }),
  ),
  unreadable: z.array(z.string()),
});

export const ClaudeStatusSchema = z.object({
  /** found null: it can't be checked on this platform. */
  cli: z.object({ found: z.boolean().nullable(), version: z.string().nullable() }),
  files: ClaudeFilesSchema,
  /** Personal files that exist, and whether git ignores them (null: not a repository, or git is missing). */
  gitignore: z.array(z.object({ file: z.string(), ignored: z.boolean().nullable() })),
  promptRunning: z.boolean(),
});
export type ClaudeStatus = z.infer<typeof ClaudeStatusSchema>;

const VersionSchema = z.string().min(1).max(200);

export const claudeContract = defineContract({
  status: { input: z.strictObject({}), output: ClaudeStatusSchema },
  /** version null: the file does not exist yet (text ''). */
  readDoc: { input: z.strictObject({ file: ClaudeDocSchema }), output: z.object({ text: z.string(), version: VersionSchema.nullable() }) },
  /** version null creates the file; a stale version is CONFLICT. */
  writeDoc: {
    input: z.strictObject({ file: ClaudeDocSchema, text: z.string().max(MAX_DOC_BYTES), version: VersionSchema.nullable() }),
    output: z.object({ version: VersionSchema }),
  },
  /** A terminal running `claude` in the package folder. */
  open: { input: z.strictObject({}), output: z.void() },
  /** A terminal running `claude --continue`. */
  continue: { input: z.strictObject({}), output: z.void() },
  /** Runs `claude -p` with the text on stdin; one run per package at a time (CONFLICT). */
  prompt: { input: z.strictObject({ text: z.string().trim().min(1).max(MAX_PROMPT_CHARS) }), output: z.void() },
  stopPrompt: { input: z.strictObject({}), output: z.void() },
  getPromptLogs: { input: z.strictObject({ afterSeq: z.number().int().nonnegative().optional() }), output: LogSnapshotSchema },
  clearPromptLogs: { input: z.strictObject({}), output: z.void() },
  /** CLAUDE.md now and with the NestBox context block applied. */
  contextPreview: {
    input: z.strictObject({}),
    output: z.object({ before: z.string(), after: z.string(), version: VersionSchema.nullable() }),
  },
  /** Writes the block; the version is the one the preview showed (CONFLICT when CLAUDE.md changed since). */
  applyContext: { input: z.strictObject({ version: VersionSchema.nullable() }), output: z.object({ version: VersionSchema }) },
});

export const claudeEvents = defineEvents({
  logs: z.object({ lines: z.array(LogLineSchema) }),
  /** A prompt run started or ended. */
  changed: z.undefined(),
});
