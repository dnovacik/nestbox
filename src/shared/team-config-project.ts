// The per-project slice of the team config. Imports only zod, so types.ts can use it without a cycle.
import { z } from 'zod';

export const TEAM_SECTIONS = [
  'commands',
  'main',
  'envFiles',
  'hidden',
  'runGroups',
  'healthChecks',
  'healthInterval',
  'mockRoutes',
  'domainNames',
  'rewriteHost',
] as const;
export type TeamSection = (typeof TEAM_SECTIONS)[number];

export const TeamConfigProjectSchema = z.object({
  acceptedHash: z.string().nullable().default(null),
  ignored: z.boolean().default(false),
  /** Local hides of team items, by section: item keys. */
  hidden: z
    .partialRecord(z.enum(TEAM_SECTIONS), z.array(z.string().max(700)).max(1000))
    .default({}),
});
export type TeamConfigProject = z.infer<typeof TeamConfigProjectSchema>;
