import { z } from 'zod';
import { defineContract, type ToolDefinition } from '../../tool';

export const DEFAULT_TAGS = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG'];

const TagSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{1,19}$/)
  .transform((t) => t.toUpperCase());
export const TagsSchema = z
  .array(TagSchema)
  .min(1)
  .max(20)
  .transform((tags) => [...new Set(tags)]);

const settingsSchema = z.object({ tags: TagsSchema.default(DEFAULT_TAGS) });

export const todosDefinition: ToolDefinition<z.infer<typeof settingsSchema>> = {
  id: 'todos',
  name: 'TODOs',
  icon: 'list-todo',
  appliesTo: () => true,
  settingsSchema,
};

export const MAX_TODOS = 5_000;

/** One tagged comment. text is project file content: shown, never logged or stored. */
export const TodoSchema = z.object({
  /** Relative to the package, '/'-separated. */
  path: z.string(),
  line: z.number().int().positive(),
  tag: z.string(),
  text: z.string().max(300),
  owner: z.string().nullable(),
});
export type Todo = z.infer<typeof TodoSchema>;

export const TodoScanSchema = z.object({
  scannedAt: z.number(),
  source: z.enum(['git', 'walk']),
  /** Files read. */
  files: z.number().int().nonnegative(),
  todos: z.array(TodoSchema).max(MAX_TODOS),
  /** Which limit stopped the scan early. */
  truncated: z.enum(['files', 'matches', 'time']).nullable(),
  durationMs: z.number().nonnegative(),
});
export type TodoScan = z.infer<typeof TodoScanSchema>;

export const todosContract = defineContract({
  /** The last scan this session, or null. */
  results: { input: z.strictObject({}), output: TodoScanSchema.nullable() },
  scan: { input: z.strictObject({}), output: TodoScanSchema },
  openFile: { input: z.strictObject({ path: z.string().min(1).max(4096), line: z.number().int().positive() }), output: z.void() },
  getTags: { input: z.strictObject({}), output: z.array(z.string()) },
  setTags: { input: z.strictObject({ tags: TagsSchema }), output: z.array(z.string()) },
});
