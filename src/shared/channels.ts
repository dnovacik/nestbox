import { z } from 'zod';
import { ProjectSummarySchema } from './detected';
import type { InvokeChannel } from './ipc-names';
import { SettingsPatchSchema, SettingsViewSchema } from './settings';
import { ToolSummarySchema } from './tool';
import { AppInfoSchema, ProjectNameSchema } from './types';

const NoInput = z.void();
const Id = z.string().min(1).max(512);
const IdInput = z.strictObject({ id: Id });

interface ChannelSpec {
  input: z.ZodType;
  output: z.ZodType;
}

export const channels = {
  'app:getInfo': { input: NoInput, output: AppInfoSchema },
  'dialog:pickFolder': { input: NoInput, output: z.string().nullable() },
  'projects:list': { input: NoInput, output: z.array(ProjectSummarySchema) },
  'projects:add': { input: z.strictObject({ path: z.string().min(1).max(4096) }), output: ProjectSummarySchema },
  'projects:remove': { input: IdInput, output: z.void() },
  'projects:rename': { input: z.strictObject({ id: Id, name: ProjectNameSchema }), output: ProjectSummarySchema },
  'projects:setPinned': { input: z.strictObject({ id: Id, pinned: z.boolean() }), output: ProjectSummarySchema },
  'projects:refresh': { input: IdInput, output: ProjectSummarySchema },
  'projects:openInEditor': { input: IdInput, output: z.void() },
  'projects:openTerminal': { input: IdInput, output: z.void() },
  'tools:list': { input: z.strictObject({ projectId: Id }), output: z.array(ToolSummarySchema) },
  'tools:invoke': {
    input: z.strictObject({
      toolId: z.string().min(1).max(100),
      projectId: Id,
      method: z.string().min(1).max(100),
      input: z.unknown(),
    }),
    // Validated against the tool's own contract by the tool host.
    output: z.unknown(),
  },
  'settings:get': { input: NoInput, output: SettingsViewSchema },
  'settings:update': { input: SettingsPatchSchema, output: SettingsViewSchema },
} as const satisfies Record<InvokeChannel, ChannelSpec>;

type Spec<C extends InvokeChannel> = (typeof channels)[C];
/** What the renderer passes. */
export type ChannelInput<C extends InvokeChannel> = z.input<Spec<C>['input']>;
/** What the renderer receives. */
export type ChannelOutput<C extends InvokeChannel> = z.output<Spec<C>['output']>;
/** What a main-process handler receives (after parsing). */
export type HandlerInput<C extends InvokeChannel> = z.output<Spec<C>['input']>;
/** What a main-process handler returns (before output validation). */
export type HandlerResult<C extends InvokeChannel> = z.input<Spec<C>['output']>;
