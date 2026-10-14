# Team Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A committed `.nestbox.json` gives teammates the same custom commands, run groups, health checks, mock routes and local domain names, accepted once per content and merged under each user's personal overrides.

**Architecture:**
- **Pure core** (`src/main/team-config/`): parse and validate the file into a canonical `TeamContent` with a content hash; merge team content with local settings per item key, and split edits back into local overrides and hides; edit the JSONC file in place.
- **`TeamConfigService`:** owns reading, watching, the trust states, the accepted snapshots, review and accept.
- **`TeamSettings` facade:** wraps the existing settings accessors (`getToolSettings`/`setToolSettings`, run groups, domains settings), so tools read the merged view without changing their storage code. It also performs share, remove, reset, hide and restore.
- **Renderer:** generic core `teamConfig:*` channels; tools only add origins to their outputs.

**Tech Stack:** TypeScript strict, Zod, `jsonc-parser` (already a main dependency), Node `crypto` (sha256), Electron main, React + TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-nestbox-v2-team-config-design.md`

## Global Constraints

- pnpm only. TypeScript strict with `noUncheckedIndexedAccess`; no `any`. No `process.platform` outside `src/main/platform/`. Renderer colours from tokens only.
- **The file:** `.nestbox.json` at the root project's folder only. JSONC, at most **256 KiB**, `"version": 1`. Packages are addressed by `package` (relPath, `""` = root), never project ids.
- **Section caps:** 100 commands, 50 run groups (new), 20 health checks per package, 100 mock routes per package.
- **Validation:** each section uses the tools' own item schemas (`CustomCommandSchema` argv rules, `RunGroupSchema`, Health's stored check schema, Mock's `RouteSchema`, domains `LABEL`). A failing section is dropped with a warning `{ section, index?, reason }`. Unknown top-level keys are ignored with a warning.
- **Hash:** sha256 of the canonical JSON (sorted keys, defaults applied) of the validated content. Comment or whitespace edits keep it; item edits change it.
- **Trust states:** `none` | `pending` | `accepted` | `changed` | `ignored` | `invalid`.
  - `pending` and `ignored` use nothing.
  - `changed` and `invalid` use the last accepted snapshot (if any).
  - `accept` takes the reviewed hash: CONFLICT if stale.
- **Storage:**
  - `Project.teamConfig = { acceptedHash: string | null, ignored: boolean, hidden: Record<section, string[]> }` with a Zod default (store stays v2);
  - the snapshot goes in `userData/team-config/<projectId>.json`, written atomically;
  - both are deleted with the project.
- **Merge keys:** `package#name` (commands, envFiles), `package` (main, healthInterval, domainNames, rewriteHost), `package#task` (hidden), the name (runGroups), `package#id` (healthChecks, mockRoutes).
  - A local item overrides the team item with the same key. `main`, `healthInterval`, `domainNames` and `rewriteHost` follow the rule "local wins". `hidden` is a union.
  - Mock ports, delay and fail settings stay local. Health `notify` stays local.
- **Writes through the merged view never touch the file.** An item equal to the team's isn't stored; a changed one is stored as an override; a deleted team item becomes a hide in `Project.teamConfig.hidden`.
- **Sharing:**
  - refused unless the state is `none` or `accepted` (VALIDATION, "Review the team config first");
  - a symlinked file → FORBIDDEN;
  - a stale version → CONFLICT;
  - edits via `jsonc-parser` `modify`/`applyEdits` keep formatting byte-identical outside the item;
  - the first share creates `{ "version": 1, … }`;
  - after NestBox's own write, the new hash is accepted automatically. NestBox never runs git.
- **Logs:** section names, counts, states, the first 8 characters of hashes, and codes only. Never command lines, URLs, env keys, route bodies or domain names.
- Version **1.31.0**. TDD (failing Vitest test first, next to the source). Conventional commits ending with a `Co-Authored-By:` trailer naming the authoring model. Prettier only on new files, or on files that were Prettier-clean at HEAD.

## Review Focus

Inputs the spec implies but no task's tests cover by default, most likely first. Each one's test lives in the owning task:

1. **A teammate's command named like a local package.json script or detected task**: the existing precedence (package.json > detected > custom) must hold and the team command must not shadow the script. (Task 9)
2. **The file changes while a run group from it is running:** the running processes are untouched, and the group keeps its accepted definition until review. (Task 6)
3. **Packages that don't exist on this machine** (a `package` relPath the detection doesn't list): items load, but the UI shows them as "package not found" and never runs them. (Task 4 merge keeps them; Task 9 marks them)
4. **A file with CRLF line endings and a BOM, edited by Share:** the output keeps CRLF and the BOM, and is otherwise byte-identical. (Task 5)
5. **Two NestBox windows can't exist, but a `git pull` between review and accept can:** accept with the old hash is CONFLICT, and the review re-reads. (Task 6)

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/shared/team-config.ts` (create) | Sections, origins, file schemas (`TeamFileSchema` sections), `TeamContent` type, status and review schemas, channel inputs, key helpers |
| `src/shared/types.ts` (modify) | `ProjectSchema.teamConfig` default |
| `src/shared/tools/health/contract.ts`, `scripts/contract.ts` (modify) | Export `StoredCheckSchema`, `EnvFileEntrySchema` for reuse |
| `src/main/team-config/parse.ts` (create) | Text → `{ content, warnings }` or `{ error }`; `contentHash` |
| `src/main/team-config/merge.ts` (create) | Pure merge/split per section, and origins |
| `src/main/team-config/writer.ts` (create) | JSONC edits: put/remove one item, create the file |
| `src/main/team-config/service.ts` (create) | Reading, watching, trust states, snapshots, review/diff, accept/ignore |
| `src/main/team-config/settings.ts` (create) | Merged accessors for tools, run groups and domains; share, removeShared, resetOverride, hide, restore |
| `src/shared/channels.ts`, `ipc-names.ts`, `client.ts`, `src/main/ipc/core-handlers.ts`, `src/main/index.ts`, `src/main/projects/project-service.ts` (modify) | Channels, wiring, cleanup on project removal |
| `src/main/tools/scripts/index.ts`, `health/index.ts`, `mock/index.ts`, `src/main/domains/service.ts` + their contracts (modify) | `origin` on returned items; hidden team items |
| `src/renderer/team-config/*` (create) | Hooks, banner, review dialog, Team config… dialog, origin badge and item actions |
| Scripts/RunGroups/Health/Mock/LocalDomainDialog/ProjectHeader/project-info (modify) | Badges and actions |
| `e2e/team-config.spec.ts`, `e2e/fixtures/team-app/` (create) | End to end |

---

### Task 1: Shared schemas and the project default

**Files:**
- Create: `src/shared/team-config-project.ts` (`TEAM_SECTIONS`, `TeamSection`, `TeamConfigProjectSchema`; imports only `zod`, so `types.ts` can import it without a cycle), `src/shared/team-config.ts` (re-exports both), `src/shared/team-config.test.ts`
- Modify: `src/shared/types.ts` (`ProjectSchema`), `src/shared/tools/health/contract.ts` (export `StoredCheckSchema`), `src/shared/tools/scripts/contract.ts` (export `EnvFileEntrySchema`)

**Interfaces:**
- Produces (from `src/shared/team-config.ts`):
  - `TEAM_FILE = '.nestbox.json'`, `TEAM_FILE_MAX_BYTES = 256 * 1024`;
  - `TEAM_SECTIONS = ['commands','main','envFiles','hidden','runGroups','healthChecks','healthInterval','mockRoutes','domainNames','rewriteHost'] as const`, `type TeamSection`;
  - `ORIGINS = ['team','local','override'] as const`, `type Origin`;
  - `TRUST_STATES = ['none','pending','accepted','changed','ignored','invalid'] as const`, `type TeamTrustState`;
  - `PackagePathSchema` (posix relPath without `#`, `..` or a leading `/`, max 512; `""` allowed);
  - `TeamContentSchema` (canonical, all sections present), `type TeamContent`;
  - `EMPTY_CONTENT: TeamContent`;
  - `itemKey(...parts)`, `splitKey(key)`;
  - `TeamConfigProjectSchema` (`{ acceptedHash, ignored, hidden }`);
  - `TeamWarningSchema`, `TeamStatusSchema`, `TeamReviewSchema`, `TeamItemInputSchema` (`{ projectId, section, key }`), `TeamAcceptInputSchema` (`{ projectId, hash }`).

- [ ] **Step 1: Export the reusable item schemas.**
  - In `src/shared/tools/health/contract.ts`, change `const StoredCheckSchema =` to `export const StoredCheckSchema =`.
  - In `src/shared/tools/scripts/contract.ts`, extract the `envFiles` element into `export const EnvFileEntrySchema = RunGroupEntrySchema.extend({ file: EnvFileNameSchema.nullable() });` and use it in `settingsSchema` (`envFiles: z.array(EnvFileEntrySchema).max(500).default([])`).
  
  Run `pnpm typecheck`; expect no errors.

- [ ] **Step 2: Write the failing test** `src/shared/team-config.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { ProjectSchema } from './types';
import {
  EMPTY_CONTENT,
  itemKey,
  PackagePathSchema,
  splitKey,
  TeamContentSchema,
  TeamItemInputSchema,
} from './team-config';

describe('team config schemas', () => {
  it('gives every project a default team-config state, so the store stays at v2', () => {
    const p = ProjectSchema.parse({ id: 'p1', name: 'shop', path: 'C:\\shop' });
    expect(p.teamConfig).toEqual({ acceptedHash: null, ignored: false, hidden: {} });
  });

  it('accepts package paths as relPaths only', () => {
    for (const ok of ['', 'packages/api', 'apps/web-2']) expect(PackagePathSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['/abs', '../up', 'a/../b', 'a#b', 'C:\\x', 'a\\b']) expect(PackagePathSchema.safeParse(bad).success).toBe(false);
  });

  it('keys items as package#rest, splitting at the first #', () => {
    expect(itemKey('packages/api', 'route#1')).toBe('packages/api#route#1');
    expect(splitKey('packages/api#route#1')).toEqual({ pkg: 'packages/api', rest: 'route#1' });
    expect(splitKey('Full stack')).toEqual({ pkg: '', rest: 'Full stack' });
  });

  it('has an empty canonical content and validates a section', () => {
    expect(TeamContentSchema.parse(EMPTY_CONTENT)).toEqual(EMPTY_CONTENT);
    expect(TeamItemInputSchema.safeParse({ projectId: 'p1', section: 'commands', key: '#dev' }).success).toBe(true);
    expect(TeamItemInputSchema.safeParse({ projectId: 'p1', section: 'nope', key: 'x' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run src/shared/team-config.test.ts`
Expected: FAIL, "Failed to resolve import ./team-config".

- [ ] **Step 4: Write `src/shared/team-config.ts`**

```ts
// Team config (v1.31): the committed .nestbox.json that shares commands, run groups, health checks, mock
// routes and local domain names with teammates. Canonical content, keys, trust states and channel inputs.
import { z } from 'zod';
import { LABEL } from './domains';
import { StoredCheckSchema } from './tools/health/contract';
import { RouteSchema } from './tools/mock/contract';
import { CustomCommandSchema, EnvFileEntrySchema } from './tools/scripts/contract';
import { RunGroupSchema } from './types';

export const TEAM_FILE = '.nestbox.json';
export const TEAM_FILE_MAX_BYTES = 256 * 1024;
export const MAX_TEAM_RUN_GROUPS = 50;

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

export const ORIGINS = ['team', 'local', 'override'] as const;
export type Origin = (typeof ORIGINS)[number];

export const TRUST_STATES = ['none', 'pending', 'accepted', 'changed', 'ignored', 'invalid'] as const;
export type TeamTrustState = (typeof TRUST_STATES)[number];

/** A package's posix relPath inside the root ('' = the root): no '#', no '..', not absolute. */
export const PackagePathSchema = z
  .string()
  .max(512)
  .refine((p) => p === '' || (!p.startsWith('/') && !p.includes('\\') && !p.includes('#') && !/^[A-Za-z]:/.test(p)), 'not a package path')
  .refine((p) => p.split('/').every((seg) => seg !== '..' && seg !== '.' && (p === '' || seg !== '')), 'not a package path');

/** The validated, canonical content of a team file, in the tools' own shapes (relPath, not package). */
export const TeamContentSchema = z.object({
  commands: z.array(CustomCommandSchema).max(100),
  main: z.record(z.string(), z.string()),
  envFiles: z.array(EnvFileEntrySchema).max(500),
  hidden: z.record(z.string(), z.array(z.string())),
  runGroups: z.array(RunGroupSchema).max(MAX_TEAM_RUN_GROUPS),
  health: z.record(z.string(), z.object({ intervalSec: z.number().int().min(5).max(600).nullable(), checks: z.array(StoredCheckSchema).max(20) })),
  mock: z.record(z.string(), z.object({ routes: z.array(RouteSchema).max(100) })),
  domainNames: z.record(z.string(), z.string().regex(LABEL)),
  rewriteHost: z.record(z.string(), z.literal(true)),
});
export type TeamContent = z.infer<typeof TeamContentSchema>;

export const EMPTY_CONTENT: TeamContent = {
  commands: [],
  main: {},
  envFiles: [],
  hidden: {},
  runGroups: [],
  health: {},
  mock: {},
  domainNames: {},
  rewriteHost: {},
};

/** `package#rest`: a package path never contains '#', so the first '#' splits. */
export const itemKey = (pkg: string, rest: string) => `${pkg}#${rest}`;
export function splitKey(key: string): { pkg: string; rest: string } {
  const at = key.indexOf('#');
  return at === -1 ? { pkg: '', rest: key } : { pkg: key.slice(0, at), rest: key.slice(at + 1) };
}

export const TeamConfigProjectSchema = z.object({
  acceptedHash: z.string().nullable().default(null),
  ignored: z.boolean().default(false),
  /** Local hides of team items, by section: item keys. */
  hidden: z.record(z.enum(TEAM_SECTIONS), z.array(z.string().max(700)).max(1000)).default({}),
});
export type TeamConfigProject = z.infer<typeof TeamConfigProjectSchema>;

export const TeamWarningSchema = z.object({
  section: z.string(),
  index: z.number().int().nullable(),
  reason: z.string(),
});
export type TeamWarning = z.infer<typeof TeamWarningSchema>;

export const TeamStatusSchema = z.object({
  state: z.enum(TRUST_STATES),
  /** First 12 hex chars of the file's content hash; null without a readable file. */
  hash: z.string().nullable(),
  counts: z.object({ commands: z.number(), runGroups: z.number(), healthChecks: z.number(), mockRoutes: z.number(), domainNames: z.number() }),
  warnings: z.array(TeamWarningSchema),
  /** invalid: why (e.g. "Line 4, column 2: unexpected token", "made by a newer NestBox"). */
  error: z.string().nullable(),
  /** The store couldn't be saved: accepting works for this session only. */
  readOnly: z.boolean(),
});
export type TeamStatus = z.infer<typeof TeamStatusSchema>;

const ChangeSchema = z.object({ section: z.enum(TEAM_SECTIONS), key: z.string(), change: z.enum(['added', 'changed', 'removed']) });
export const TeamReviewSchema = z.object({
  /** The full hash to pass back to accept. */
  hash: z.string().nullable(),
  content: TeamContentSchema,
  /** changed only: what differs from the accepted snapshot. */
  diff: z.array(ChangeSchema).nullable(),
  warnings: z.array(TeamWarningSchema),
});
export type TeamReview = z.infer<typeof TeamReviewSchema>;

const ProjectId = z.string().min(1).max(512);
export const TeamProjectInputSchema = z.strictObject({ projectId: ProjectId });
export const TeamAcceptInputSchema = z.strictObject({ projectId: ProjectId, hash: z.string().regex(/^[0-9a-f]{64}$/) });
export const TeamItemInputSchema = z.strictObject({ projectId: ProjectId, section: z.enum(TEAM_SECTIONS), key: z.string().min(1).max(700) });
```

Move `TEAM_SECTIONS`, `TeamSection` and `TeamConfigProjectSchema` (with its `z.enum(TEAM_SECTIONS)` record) out of the block above into `src/shared/team-config-project.ts`, and re-export them from `team-config.ts` (`export { TEAM_SECTIONS, type TeamSection, TeamConfigProjectSchema, type TeamConfigProject } from './team-config-project';`). `team-config.ts` imports `RunGroupSchema` from `./types`, so `types.ts` must not import `team-config.ts`.

In `src/shared/types.ts`, add to `ProjectSchema` (import `TeamConfigProjectSchema` from `./team-config-project`):

```ts
  /** Team config (v1.31): the accepted .nestbox.json hash, "never for this project", and local hides. */
  teamConfig: TeamConfigProjectSchema.default(() => TeamConfigProjectSchema.parse({})),
```


- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm vitest run src/shared && pnpm typecheck`
Expected: PASS. Tests that compare whole `Project` literals may need `teamConfig: { acceptedHash: null, ignored: false, hidden: {} }`.

- [ ] **Step 6: Commit**

```bash
git add src/shared
git commit -m "feat(team-config): shared schemas, keys and the project default"
```

---

### Task 2: Parse, validate and hash the file

**Files:**
- Create: `src/main/team-config/parse.ts`, `src/main/team-config/parse.test.ts`

**Interfaces:**
- Consumes: `TeamContent`, `EMPTY_CONTENT`, `PackagePathSchema`, `TEAM_FILE_MAX_BYTES`, the item schemas (Task 1).
- Produces:
  - `type ParseResult = { ok: true; content: TeamContent; warnings: TeamWarning[]; hash: string } | { ok: false; error: string }`;
  - `parseTeamFile(text: string): ParseResult`;
  - `contentHash(content: TeamContent): string` (64 hex);
  - `canonicalJson(value: unknown): string`.

- [ ] **Step 1: Write the failing test** `src/main/team-config/parse.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { contentHash, parseTeamFile } from './parse';

const FILE = `{
  // the team's setup
  "version": 1,
  "commands": [{ "package": "", "name": "api", "argv": ["dotnet", "watch"] },],
  "main": { "": "dev" },
  "runGroups": [{ "name": "Full stack", "entries": [{ "package": "", "script": "dev" }], "compose": [{ "package": "", "services": ["db"] }] }],
  "health": { "packages/api": { "intervalSec": 30, "checks": [{ "id": "up", "kind": "env", "key": "API_URL", "path": "/health" }] } },
  "mock": { "": { "routes": [{ "id": "users", "method": "GET", "path": "/api/users", "body": "[]" }] } },
  "domains": { "names": { "": "shop" }, "rewriteHost": { "packages/web": true } },
  "envFiles": [{ "package": "", "name": "api", "file": ".env.local" }],
  "hidden": { "": ["ci"] }
}`;

describe('parseTeamFile', () => {
  it('reads every section into the tools\' shapes (package → relPath), with defaults applied', () => {
    const r = parseTeamFile(FILE);
    if (!r.ok) throw new Error(r.error);
    expect(r.warnings).toEqual([]);
    expect(r.content.commands).toEqual([{ relPath: '', name: 'api', argv: ['dotnet', 'watch'] }]);
    expect(r.content.runGroups[0]).toEqual({ name: 'Full stack', entries: [{ relPath: '', script: 'dev' }], compose: [{ relPath: '', services: ['db'] }] });
    expect(r.content.health['packages/api']).toEqual({ intervalSec: 30, checks: [{ id: 'up', kind: 'env', key: 'API_URL', path: '/health' }] });
    expect(r.content.mock['']?.routes[0]).toMatchObject({ id: 'users', method: 'GET', status: 200, enabled: true });
    expect(r.content.domainNames).toEqual({ '': 'shop' });
    expect(r.content.rewriteHost).toEqual({ 'packages/web': true });
    expect(r.content.envFiles).toEqual([{ relPath: '', script: 'api', file: '.env.local' }]);
    expect(r.content.hidden).toEqual({ '': ['ci'] });
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the hash across comment and whitespace edits, and changes it for an item edit', () => {
    const a = parseTeamFile(FILE);
    const b = parseTeamFile(FILE.replace('// the team\'s setup', '/* edited */').replace(/\n {2}/g, '\n    '));
    const c = parseTeamFile(FILE.replace('"dotnet", "watch"', '"dotnet", "run"'));
    if (!a.ok || !b.ok || !c.ok) throw new Error('parse');
    expect(b.hash).toBe(a.hash);
    expect(c.hash).not.toBe(a.hash);
  });

  it('drops an invalid section with a warning naming it, keeping the rest', () => {
    const r = parseTeamFile('{ "version": 1, "commands": [{ "package": "", "name": "x", "argv": ["a\\"b"] }], "main": { "": "dev" } }');
    if (!r.ok) throw new Error(r.error);
    expect(r.content.commands).toEqual([]);
    expect(r.content.main).toEqual({ '': 'dev' });
    expect(r.warnings).toEqual([{ section: 'commands', index: 0, reason: expect.any(String) }]);
    expect(JSON.stringify(r.warnings)).not.toContain('a\\"b');
  });

  it('refuses bad package paths, unknown keys get a warning, caps apply', () => {
    const r = parseTeamFile(JSON.stringify({ version: 1, main: { '../x': 'dev' }, extra: 1, commands: Array.from({ length: 101 }, (_, i) => ({ package: '', name: `c${i}`, argv: ['x'] })) }));
    if (!r.ok) throw new Error(r.error);
    expect(r.content.main).toEqual({});
    expect(r.content.commands).toEqual([]);
    expect(r.warnings.map((w) => w.section).sort()).toEqual(['commands', 'extra', 'main']);
  });

  it('is invalid for non-JSONC, a non-object root, an unknown version, or too much text', () => {
    expect(parseTeamFile('{ "version": 1, ')).toEqual({ ok: false, error: expect.stringMatching(/^Line \d+, column \d+/) });
    expect(parseTeamFile('[1]')).toEqual({ ok: false, error: 'The file is not a JSON object' });
    expect(parseTeamFile('{ "version": 2 }')).toEqual({ ok: false, error: 'Made by a newer NestBox (version 2)' });
    expect(parseTeamFile(' '.repeat(256 * 1024 + 1))).toEqual({ ok: false, error: 'The file is larger than 256 KiB' });
  });

  it('hashes canonical content, independent of key order', () => {
    const r1 = parseTeamFile('{ "version": 1, "main": { "a": "x", "b": "y" } }');
    const r2 = parseTeamFile('{ "main": { "b": "y", "a": "x" }, "version": 1 }');
    if (!r1.ok || !r2.ok) throw new Error('parse');
    expect(contentHash(r1.content)).toBe(contentHash(r2.content));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/main/team-config/parse.test.ts`
Expected: FAIL, "Failed to resolve import ./parse".

- [ ] **Step 3: Write `src/main/team-config/parse.ts`**

```ts
// .nestbox.json → canonical TeamContent. Each section is validated with the tools' own schemas; a failing
// section is dropped with a warning (section and index only, never values). The hash is over canonical JSON,
// so comments and formatting don't change it.
import { createHash } from 'node:crypto';
import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser';
import { z } from 'zod';
import { LABEL } from '@shared/domains';
import {
  EMPTY_CONTENT,
  MAX_TEAM_RUN_GROUPS,
  PackagePathSchema,
  TEAM_FILE_MAX_BYTES,
  type TeamContent,
  type TeamWarning,
} from '@shared/team-config';
import { StoredCheckSchema } from '@shared/tools/health/contract';
import { RouteSchema } from '@shared/tools/mock/contract';
import { CustomCommandSchema, EnvFileEntrySchema } from '@shared/tools/scripts/contract';
import { RunGroupSchema } from '@shared/types';

export type ParseResult =
  | { ok: true; content: TeamContent; warnings: TeamWarning[]; hash: string }
  | { ok: false; error: string };

const KNOWN = new Set(['version', 'commands', 'main', 'envFiles', 'hidden', 'runGroups', 'health', 'mock', 'domains']);
const Pkg = PackagePathSchema;

/** The file's shapes ("package"), mapped to the tools' shapes ("relPath"). */
const FileCommand = z.object({ package: Pkg, name: z.string(), argv: z.array(z.string()) }).transform((c) => CustomCommandSchema.parse({ relPath: c.package, name: c.name, argv: c.argv }));
const FileEnvFile = z.object({ package: Pkg, name: z.string(), file: z.string().nullable() }).transform((e) => EnvFileEntrySchema.parse({ relPath: e.package, script: e.name, file: e.file }));
const FileRunGroup = z
  .object({
    name: z.string(),
    entries: z.array(z.object({ package: Pkg, script: z.string() })),
    compose: z.array(z.object({ package: Pkg, services: z.array(z.string()) })).default([]),
  })
  .transform((g) =>
    RunGroupSchema.parse({
      name: g.name,
      entries: g.entries.map((e) => ({ relPath: e.package, script: e.script })),
      compose: g.compose.map((c) => ({ relPath: c.package, services: c.services })),
    }),
  );

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export const contentHash = (content: TeamContent) => createHash('sha256').update(canonicalJson(content)).digest('hex');

function lineColumn(text: string, offset: number): string {
  const before = text.slice(0, offset).split(/\r\n|\r|\n/);
  return `Line ${before.length}, column ${(before.at(-1)?.length ?? 0) + 1}`;
}

/** Validates an array section item by item; the whole section is dropped on any failure (spec §1). */
function arraySection<T>(raw: unknown, schema: z.ZodType<T>, max: number, section: string, warnings: TeamWarning[]): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push({ section, index: null, reason: 'not a list' });
    return [];
  }
  if (raw.length > max) {
    warnings.push({ section, index: null, reason: `more than ${max} items` });
    return [];
  }
  const out: T[] = [];
  for (const [index, item] of raw.entries()) {
    const r = schema.safeParse(item);
    if (!r.success) {
      warnings.push({ section, index, reason: r.error.issues[0]?.message ?? 'invalid' });
      return [];
    }
    out.push(r.data);
  }
  return out;
}

function recordSection<T>(raw: unknown, schema: z.ZodType<T>, section: string, warnings: TeamWarning[]): Record<string, T> {
  if (raw === undefined) return {};
  const r = z.record(Pkg, schema).safeParse(raw);
  if (r.success) return r.data;
  warnings.push({ section, index: null, reason: r.error.issues[0]?.message ?? 'invalid' });
  return {};
}

export function parseTeamFile(text: string): ParseResult {
  if (Buffer.byteLength(text, 'utf8') > TEAM_FILE_MAX_BYTES) return { ok: false, error: 'The file is larger than 256 KiB' };
  const errors: ParseError[] = [];
  const root: unknown = parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true });
  const first = errors[0];
  if (first) return { ok: false, error: `${lineColumn(text, first.offset)}: ${printParseErrorCode(first.error)}` };
  if (!root || typeof root !== 'object' || Array.isArray(root)) return { ok: false, error: 'The file is not a JSON object' };
  const file = root as Record<string, unknown>;
  if (file['version'] !== 1) return { ok: false, error: `Made by a newer NestBox (version ${String(file['version'])})` };

  const warnings: TeamWarning[] = [];
  for (const key of Object.keys(file)) if (!KNOWN.has(key)) warnings.push({ section: key, index: null, reason: 'unknown section' });
  const domains = (file['domains'] ?? {}) as Record<string, unknown>;
  const health = recordSection(
    file['health'],
    z.object({ intervalSec: z.number().int().min(5).max(600).nullable().default(null), checks: z.array(StoredCheckSchema).max(20).default([]) }),
    'health',
    warnings,
  );
  const content: TeamContent = {
    ...EMPTY_CONTENT,
    commands: arraySection(file['commands'], FileCommand, 100, 'commands', warnings),
    envFiles: arraySection(file['envFiles'], FileEnvFile, 500, 'envFiles', warnings),
    runGroups: arraySection(file['runGroups'], FileRunGroup, MAX_TEAM_RUN_GROUPS, 'runGroups', warnings),
    main: recordSection(file['main'], z.string().min(1).max(60), 'main', warnings),
    hidden: recordSection(file['hidden'], z.array(z.string().min(1).max(200)).max(100), 'hidden', warnings),
    health,
    mock: recordSection(file['mock'], z.object({ routes: z.array(RouteSchema).max(100).default([]) }), 'mock', warnings),
    domainNames: recordSection(domains['names'], z.string().regex(LABEL), 'domains.names', warnings),
    rewriteHost: recordSection(domains['rewriteHost'], z.literal(true), 'domains.rewriteHost', warnings),
  };
  return { ok: true, content, warnings, hash: contentHash(content) };
}
```

Notes:
- `.transform` with `.parse` inside throws on invalid tool shapes. Wrap: define each transform with `z.object({...}).pipe(...)` instead if `safeParse` doesn't catch the inner throw. Verify by running the "drops an invalid section" test.
- The `commands` cap test (101 items) produces one `commands` warning ("more than 100 items").

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/main/team-config/parse.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/team-config/parse.ts src/main/team-config/parse.test.ts
git commit -m "feat(team-config): parse and validate .nestbox.json per section, canonical hash"
```

---

### Task 3: Merge and split

**Files:**
- Create: `src/main/team-config/merge.ts`, `src/main/team-config/merge.test.ts`

**Interfaces:**
- Consumes: `TeamContent`, `itemKey`, `splitKey`, `Origin`, `TeamSection` (Task 1); `ScriptsSettings`, `HealthSettings`, `MockSettings`, `RunGroup`, `DomainsSettings`.
- Produces:
  - `type Hidden = Partial<Record<TeamSection, string[]>>`;
  - `type Origins = Partial<Record<TeamSection, Record<string, Origin>>>`;
  - `mergeScripts(local, team, hidden) → { value: ScriptsSettings; origins: Origins }`, `splitScripts(next, team, hidden) → { local: ScriptsSettings; hidden: Hidden }`;
  - the same pairs for health (`mergeHealth`/`splitHealth`), mock (`mergeMock`/`splitMock`) and run groups (`mergeRunGroups`/`splitRunGroups`);
  - `mergeDomainNames(names, rewrite, team, hidden, idOf: (pkg) => string) → { names, rewriteHost, origins }` and `splitDomainNames(...)`.

The rules are the same in every section:
- **Merge:** effective = team items whose key isn't hidden and not overridden by local, plus all local items (a local item with a team key is an `override`).
- **Split:** for each item in `next`, an equal team item is dropped and anything else stays local. A team key missing from `next` that isn't already hidden is added to `hidden`.
- **Equality:** `canonicalJson` of the item.

- [ ] **Step 1: Write the failing test** `src/main/team-config/merge.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { EMPTY_CONTENT, type TeamContent } from '@shared/team-config';
import { scriptsDefinition } from '@shared/tools/scripts/contract';
import { mergeRunGroups, mergeScripts, splitRunGroups, splitScripts } from './merge';

const LOCAL = scriptsDefinition.settingsSchema.parse({});
const TEAM: TeamContent = {
  ...EMPTY_CONTENT,
  commands: [
    { relPath: '', name: 'api', argv: ['dotnet', 'watch'] },
    { relPath: '', name: 'worker', argv: ['node', 'w.js'] },
  ],
  main: { '': 'api' },
  hidden: { '': ['ci'] },
  runGroups: [{ name: 'Full stack', entries: [{ relPath: '', script: 'api' }], compose: [] }],
};

describe('scripts merge/split', () => {
  it('adds team items, lets local override by key, and reports origins', () => {
    const local = { ...LOCAL, commands: [{ relPath: '', name: 'api', argv: ['dotnet', 'run'] }, { relPath: '', name: 'mine', argv: ['x'] }], main: [] };
    const { value, origins } = mergeScripts(local, TEAM, {});
    expect(value.commands.map((c) => [c.name, c.argv[1] ?? null])).toEqual([
      ['worker', 'w.js'],
      ['api', 'run'],
      ['mine', null],
    ]);
    expect(origins.commands).toEqual({ '#worker': 'team', '#api': 'override', '#mine': 'local' });
    expect(value.main).toEqual([{ relPath: '', script: 'api' }]);
    expect(value.hidden).toEqual({ '': ['ci'] });
  });

  it('drops hidden team items', () => {
    const { value, origins } = mergeScripts(LOCAL, TEAM, { commands: ['#worker'] });
    expect(value.commands.map((c) => c.name)).toEqual(['api']);
    expect(origins.commands).toEqual({ '#api': 'team' });
  });

  it('splits an edit back: equal team items stored as nothing, changes as overrides, deletions as hides', () => {
    const merged = mergeScripts(LOCAL, TEAM, {}).value;
    const next = {
      ...merged,
      commands: merged.commands
        .filter((c) => c.name !== 'worker')
        .map((c) => (c.name === 'api' ? { ...c, argv: ['dotnet', 'run'] } : c))
        .concat([{ relPath: '', name: 'mine', argv: ['x'] }]),
    };
    const { local, hidden } = splitScripts(next, TEAM, {});
    expect(local.commands).toEqual([
      { relPath: '', name: 'api', argv: ['dotnet', 'run'] },
      { relPath: '', name: 'mine', argv: ['x'] },
    ]);
    expect(local.main).toEqual([]);
    expect(hidden.commands).toEqual(['#worker']);
  });

  it('round-trips with no change: nothing local, nothing hidden', () => {
    const merged = mergeScripts(LOCAL, TEAM, {}).value;
    const { local, hidden } = splitScripts(merged, TEAM, {});
    expect(local).toEqual(LOCAL);
    expect(hidden).toEqual({});
  });
});

describe('run groups merge/split', () => {
  it('overrides by name and hides deletions', () => {
    const mine = { name: 'Full stack', entries: [{ relPath: '', script: 'dev' }], compose: [] };
    const merged = mergeRunGroups([mine], TEAM, {});
    expect(merged.value).toEqual([mine]);
    expect(merged.origins.runGroups).toEqual({ 'Full stack': 'override' });
    expect(splitRunGroups([], TEAM, {}).hidden.runGroups).toEqual(['Full stack']);
  });
});
```

Add equivalent tests for health (a check override by `pkg#id`, an `intervalSec` where local wins, `notify` untouched), mock (route override by `pkg#id`; a local `port`/`delayMs`/`failAll` is never replaced by team data) and domains (team names map to project ids through `idOf`; a local name wins; a deleted team name becomes a hide).

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/main/team-config/merge.test.ts`
Expected: FAIL, "Failed to resolve import ./merge".

- [ ] **Step 3: Write `src/main/team-config/merge.ts`**

Implement one generic keyed helper and use it for every section:

```ts
import { itemKey, type Origin, type TeamContent, type TeamSection } from '@shared/team-config';
import { canonicalJson } from './parse';

export type Hidden = Partial<Record<TeamSection, string[]>>;
export type Origins = Partial<Record<TeamSection, Record<string, Origin>>>;

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

/** Team items (not hidden, not overridden) first, then local items; origins by key. */
export function mergeKeyed<T>(local: readonly T[], team: readonly T[], keyOf: (t: T) => string, hidden: readonly string[] = []) {
  const localKeys = new Set(local.map(keyOf));
  const teamKeys = new Set(team.map(keyOf));
  const origins: Record<string, Origin> = {};
  const value: T[] = [];
  for (const t of team) {
    const k = keyOf(t);
    if (hidden.includes(k) || localKeys.has(k)) continue;
    value.push(t);
    origins[k] = 'team';
  }
  for (const l of local) {
    const k = keyOf(l);
    value.push(l);
    origins[k] = teamKeys.has(k) && !hidden.includes(k) ? 'override' : 'local';
  }
  return { value, origins };
}

/** next → what stays local, and which team keys became hidden. */
export function splitKeyed<T>(next: readonly T[], team: readonly T[], keyOf: (t: T) => string, hidden: readonly string[] = []) {
  const teamByKey = new Map(team.map((t) => [keyOf(t), t] as const));
  const nextKeys = new Set(next.map(keyOf));
  const local = next.filter((n) => {
    const t = teamByKey.get(keyOf(n));
    return !(t !== undefined && !hidden.includes(keyOf(n)) && same(t, n));
  });
  const newlyHidden = [...teamByKey.keys()].filter((k) => !nextKeys.has(k) && !hidden.includes(k));
  return { local, hidden: [...hidden, ...newlyHidden] };
}
```

Section functions (all exported):
- **Scripts:** `commands` (key `itemKey(relPath, name)`), `envFiles` (key `itemKey(relPath, script)`), `main` (convert the array `{relPath, script}` to a key `relPath`; local wins, so `mergeKeyed` works with key `relPath`), `hidden` (flatten to `itemKey(relPath, task)` items; merge = union, so team tasks not hidden plus local tasks; split: a team task missing from next → hidden key). `autoRestart` passes through untouched.
- **Health:** checks per package with key `itemKey(pkg, id)`, rebuilt into `packages[pkg].checks`; `intervalSec` with key `pkg` (local wins; team `null` means no team value); `notify` and any other field pass through.
- **Mock:** routes per package with key `itemKey(pkg, id)`; `port`, `delayMs` and `failAll` always come from local (defaults when there's no local package entry).
- **Run groups:** key `name`.
- **Domains:** `idOf(pkg)` maps relPaths to project ids (`rootId` or `workspaceId(rootId, pkg)`). Team entries with no local entry for that id are added (origin `team`). A local entry with a team key is an `override` when the values differ, else it's dropped on split.

Return `hidden` from each split only for sections that changed, so the caller can merge them into `Project.teamConfig.hidden` (`{ ...current, ...returned }`).

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/main/team-config/merge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/team-config/merge.ts src/main/team-config/merge.test.ts
git commit -m "feat(team-config): merge team items under local overrides, split edits into overrides and hides"
```

---

### Task 4: Edit the file in place

**Files:**
- Create: `src/main/team-config/writer.ts`, `src/main/team-config/writer.test.ts`

**Interfaces:**
- Consumes: `TeamSection`, `splitKey` (Task 1); `jsonc-parser` (`parseTree`, `findNodeAtLocation`, `modify`, `applyEdits`).
- Produces:
  - `putItem(text: string | null, section: TeamSection, key: string, item: unknown) → string`: a new file when `text` is null; otherwise adds or replaces the item;
  - `removeItem(text: string, section: TeamSection, key: string) → string`;
  - `toFileItem(section, key, value) → { path: (string|number)[]; value: unknown }`: the file's shape, using `package` and dropping fields equal to defaults.

**File paths per section:**
- `commands`/`envFiles`/`runGroups`: an array, matched by `package`+`name` (or `name`) and replaced in place, else appended.
- `main` → `["main", pkg]`; `hidden` → `["hidden", pkg]` (the array is rewritten with the task added or removed).
- `healthChecks` → `["health", pkg, "checks"]`, matched by id; `healthInterval` → `["health", pkg, "intervalSec"]`.
- `mockRoutes` → `["mock", pkg, "routes"]`, matched by id.
- `domainNames` → `["domains", "names", pkg]`; `rewriteHost` → `["domains", "rewriteHost", pkg]`.

**Formatting:** detect `insertSpaces`/`tabSize` from the first indented line, `eol` from the text (`\r\n` if present), and keep a BOM. Use the same approach as `formatting()`/`edit()` in `src/main/tools/env/appsettings.ts`: copy those two helpers into `writer.ts`; extract them to a shared module only if lint flags duplication.

- [ ] **Step 1: Write the failing test** `src/main/team-config/writer.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseTeamFile } from './parse';
import { putItem, removeItem } from './writer';

const CRLF_BOM = '\uFEFF{\r\n  // team\r\n  "version": 1,\r\n  "commands": [\r\n    { "package": "", "name": "api", "argv": ["dotnet", "watch"] }\r\n  ]\r\n}\r\n';

describe('team file writer', () => {
  it('creates the file with version 1', () => {
    const text = putItem(null, 'commands', '#dev', { relPath: '', name: 'dev', argv: ['vite'] });
    const r = parseTeamFile(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.content.commands).toEqual([{ relPath: '', name: 'dev', argv: ['vite'] }]);
    expect(text).toContain('"version": 1');
    expect(text).toContain('"package": ""');
  });

  it('appends, keeping CRLF, the BOM and the comment byte-identical (Review Focus 4)', () => {
    const out = putItem(CRLF_BOM, 'commands', '#dev', { relPath: '', name: 'dev', argv: ['vite'] });
    expect(out.startsWith('\uFEFF{\r\n  // team\r\n  "version": 1,')).toBe(true);
    expect(out).not.toMatch(/[^\r]\n/);
    const r = parseTeamFile(out);
    if (!r.ok) throw new Error(r.error);
    expect(r.content.commands.map((c) => c.name)).toEqual(['api', 'dev']);
  });

  it('replaces an item with the same key in place, and removes one', () => {
    const replaced = putItem(CRLF_BOM, 'commands', '#api', { relPath: '', name: 'api', argv: ['dotnet', 'run'] });
    const r = parseTeamFile(replaced);
    if (!r.ok) throw new Error(r.error);
    expect(r.content.commands).toEqual([{ relPath: '', name: 'api', argv: ['dotnet', 'run'] }]);
    const removed = parseTeamFile(removeItem(replaced, 'commands', '#api'));
    if (!removed.ok) throw new Error(removed.error);
    expect(removed.content.commands).toEqual([]);
  });

  it('writes nested sections: health checks, mock routes, domain names, main, hidden', () => {
    let text = putItem(null, 'healthChecks', 'packages/api#up', { id: 'up', kind: 'url', url: 'http://localhost:3000/health' });
    text = putItem(text, 'mockRoutes', '#users', { id: 'users', method: 'GET', path: '/api/users', status: 200, contentType: 'json', headers: [], body: '[]', delayMs: 0, fail: { on: false, status: 500 }, enabled: true });
    text = putItem(text, 'domainNames', 'packages/api', 'api');
    text = putItem(text, 'main', '', 'dev');
    text = putItem(text, 'hidden', '#ci', 'ci');
    const r = parseTeamFile(text);
    if (!r.ok) throw new Error(r.error);
    expect(r.content.health['packages/api']?.checks).toEqual([{ id: 'up', kind: 'url', url: 'http://localhost:3000/health' }]);
    expect(r.content.mock['']?.routes[0]).toMatchObject({ id: 'users', path: '/api/users' });
    expect(text).not.toContain('"delayMs": 0');
    expect(r.content.domainNames).toEqual({ 'packages/api': 'api' });
    expect(r.content.main).toEqual({ '': 'dev' });
    expect(r.content.hidden).toEqual({ '': ['ci'] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/main/team-config/writer.test.ts`
Expected: FAIL, "Failed to resolve import ./writer".

- [ ] **Step 3: Implement `writer.ts`** to the interface and paths above.
  - `toFileItem` maps `relPath` → `package` and `script` → `name` (envFiles), and drops route fields equal to `RouteSchema` defaults (compare against `RouteSchema.parse({ id, method, path })`).
  - Array matching walks `parseTree` → `findNodeAtLocation(tree, [arrayKey])` children, compares each child's `package`/`name`/`id` property values (via `getNodeValue`), and uses the child's index in the path for replace or remove. Append uses index `-1` with `isArrayInsertion: true`.
  - Creating a missing parent object (e.g. `health.<pkg>`) is handled by `modify` setting the whole sub-object when the path doesn't exist.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/main/team-config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/team-config/writer.ts src/main/team-config/writer.test.ts
git commit -m "feat(team-config): edit .nestbox.json items in place, formatting kept"
```

---

### Task 5: The service: reading, trust, snapshots, review

**Files:**
- Create: `src/main/team-config/service.ts`, `src/main/team-config/service.test.ts`

**Interfaces:**
- Consumes: `parseTeamFile` (Task 2), `Hidden` (Task 3, `merge.ts`), `TeamContent`, `TeamStatus`, `TeamReview`, `TeamConfigProject` (Task 1).
- Produces:

```ts
export interface TeamFileAccess {
  /** null when the file doesn't exist. */
  read(dir: string): Promise<{ text: string; version: string; symlink: boolean } | null>;
  write(dir: string, text: string, expectedVersion: string | null): Promise<{ version: string }>;
}
export interface TeamConfigServiceDeps {
  roots(): readonly { id: string; path: string }[];
  file: TeamFileAccess;
  project: { get(rootId: string): TeamConfigProject; update(rootId: string, fn: (p: TeamConfigProject) => TeamConfigProject): void; readOnly(): boolean };
  snapshots: { read(rootId: string): Promise<TeamContent | null>; write(rootId: string, content: TeamContent): Promise<void>; remove(rootId: string): Promise<void> };
  watch(dir: string, onChange: () => void): (() => void) | null;
  emit(rootId: string): void;
  logger: Logger;
}
export interface TeamConfigService {
  /** The content tools merge with: the accepted file, else the accepted snapshot (changed/invalid), else nothing. */
  effective(rootId: string): { content: TeamContent | null; hidden: Hidden };
  status(rootId: string): Promise<TeamStatus>;
  review(rootId: string): Promise<TeamReview>;
  accept(rootId: string, hash: string): Promise<TeamStatus>;
  ignore(rootId: string): Promise<TeamStatus>;
  unignore(rootId: string): Promise<TeamStatus>;
  /** Re-reads (project added, refreshed, or a write by NestBox). */
  refresh(rootId: string): Promise<void>;
  /** NestBox wrote the file: accept the new content without review. */
  acceptOwnWrite(rootId: string, text: string): Promise<void>;
  /** The file text and version for an edit; throws VALIDATION unless state is none/accepted, FORBIDDEN for a symlink. */
  forEdit(rootId: string): Promise<{ text: string | null; version: string | null }>;
  forget(rootId: string): Promise<void>;
  start(): void;
  stop(): void;
}
```

**State logic** (per root, from the last read):
- no file → `none`;
- `project.ignored` → `ignored`;
- a parse error → `invalid` (keeping the snapshot for `effective`);
- the hash equals `acceptedHash` → `accepted`;
- `acceptedHash` set but different → `changed`;
- otherwise → `pending`.

`effective()`:
- `accepted`: the parsed content.
- `changed`/`invalid`: the snapshot, or null.
- `none`: the snapshot is removed and the content is null. A deleted file means no team config. On reaching `none`, also set `acceptedHash: null`.
- `pending`/`ignored`: null.

`effective()` is **synchronous**: the service caches the parsed content and the snapshot per root after each read.

`review()`:
- returns the current parsed content, its full hash and warnings;
- in `changed`, also a `diff` against the snapshot, keyed per section with the same keys as merge.ts (added/changed/removed).

`accept(rootId, hash)`:
- re-reads the file first; if the fresh hash ≠ `hash` → CONFLICT ("The team config changed; review it again") (Review Focus 5);
- otherwise sets `acceptedHash` and writes the snapshot.

**Watching:** `start()` watches each root folder (`watchDir(path, false, name => name === '.nestbox.json' && debounce(300))`) and re-reads on change. Roots added later are picked up on `refresh(rootId)`. `stop()` closes all watchers.

- [ ] **Step 1: Write the failing test** `src/main/team-config/service.test.ts`. Use an in-memory `TeamFileAccess`, a map for `project` and snapshots, and `watch: () => null`; call `refresh` explicitly. Cover:

```ts
import { describe, expect, it, vi } from 'vitest';
import { TeamConfigProjectSchema, type TeamConfigProject, type TeamContent } from '@shared/team-config';
import { createMemoryLogger } from '../logger';
import { createTeamConfigService } from './service';

function setup(initial: string | null) {
  let text = initial;
  let version = 1;
  let project: TeamConfigProject = TeamConfigProjectSchema.parse({});
  const snaps = new Map<string, TeamContent>();
  const emit = vi.fn();
  const service = createTeamConfigService({
    roots: () => [{ id: 'r1', path: '/repo' }],
    file: {
      read: async () => (text === null ? null : { text, version: String(version), symlink: false }),
      write: async (_d, t) => {
        text = t;
        version += 1;
        return { version: String(version) };
      },
    },
    project: { get: () => project, update: (_id, fn) => void (project = fn(project)), readOnly: () => false },
    snapshots: { read: async (id) => snaps.get(id) ?? null, write: async (id, c) => void snaps.set(id, c), remove: async (id) => void snaps.delete(id) },
    watch: () => null,
    emit,
    logger: createMemoryLogger(),
  });
  return { service, setText: (t: string | null) => { text = t; version += 1; }, project: () => project, emit };
}

const V1 = '{ "version": 1, "commands": [{ "package": "", "name": "api", "argv": ["dotnet", "watch"] }] }';
const V2 = '{ "version": 1, "commands": [{ "package": "", "name": "api", "argv": ["dotnet", "run"] }] }';

describe('team config service', () => {
  it('is none without a file and pending for a new one; pending contributes nothing', async () => {
    const s = setup(null);
    await s.service.refresh('r1');
    expect((await s.service.status('r1')).state).toBe('none');
    s.setText(V1);
    await s.service.refresh('r1');
    expect((await s.service.status('r1')).state).toBe('pending');
    expect(s.service.effective('r1').content).toBeNull();
  });

  it('accepts the reviewed hash, then uses the file', async () => {
    const s = setup(V1);
    await s.service.refresh('r1');
    const { hash } = await s.service.review('r1');
    if (!hash) throw new Error('hash');
    expect((await s.service.accept('r1', hash)).state).toBe('accepted');
    expect(s.service.effective('r1').content?.commands[0]?.argv).toEqual(['dotnet', 'watch']);
  });

  it('keeps the accepted snapshot while the file changed, and shows a diff (Review Focus 2)', async () => {
    const s = setup(V1);
    await s.service.refresh('r1');
    await s.service.accept('r1', (await s.service.review('r1')).hash ?? '');
    s.setText(V2);
    await s.service.refresh('r1');
    expect((await s.service.status('r1')).state).toBe('changed');
    expect(s.service.effective('r1').content?.commands[0]?.argv).toEqual(['dotnet', 'watch']);
    expect((await s.service.review('r1')).diff).toEqual([{ section: 'commands', key: '#api', change: 'changed' }]);
  });

  it('refuses a stale accept after the file changed under the review (Review Focus 5)', async () => {
    const s = setup(V1);
    await s.service.refresh('r1');
    const { hash } = await s.service.review('r1');
    s.setText(V2);
    await expect(s.service.accept('r1', hash ?? '')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('is invalid for a broken file but keeps the snapshot; ignored contributes nothing', async () => {
    const s = setup(V1);
    await s.service.refresh('r1');
    await s.service.accept('r1', (await s.service.review('r1')).hash ?? '');
    s.setText('{ broken');
    await s.service.refresh('r1');
    const st = await s.service.status('r1');
    expect(st.state).toBe('invalid');
    expect(st.error).toMatch(/^Line 1/);
    expect(s.service.effective('r1').content?.commands).toHaveLength(1);
    await s.service.ignore('r1');
    expect((await s.service.status('r1')).state).toBe('ignored');
    expect(s.service.effective('r1').content).toBeNull();
  });

  it('refuses edits unless none or accepted, and auto-accepts its own write', async () => {
    const s = setup(V1);
    await s.service.refresh('r1');
    await expect(s.service.forEdit('r1')).rejects.toMatchObject({ code: 'VALIDATION' });
    await s.service.accept('r1', (await s.service.review('r1')).hash ?? '');
    const { text } = await s.service.forEdit('r1');
    await s.service.acceptOwnWrite('r1', (text ?? '').replace('watch', 'run'));
    expect((await s.service.status('r1')).state).toBe('accepted');
  });
});
```

Also add a test that a symlinked file makes `forEdit` throw FORBIDDEN, and one that `status().readOnly` follows `project.readOnly()`.

- [ ] **Step 2: Run it to verify it fails**, then implement `service.ts` to the interface and state logic above, using a per-root cache `{ read: ParseResult | null; text: string | null; version: string | null; symlink: boolean; snapshot: TeamContent | null }`.
  - `acceptOwnWrite(rootId, text)`: write the file through `deps.file.write(dir, text, version)` (CONFLICT propagates), parse the text, set `acceptedHash`, write the snapshot, then `emit`.
  - Log `{ state, hash: hash.slice(0, 8), commands, runGroups, warnings }` counts only.

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run src/main/team-config`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/team-config/service.ts src/main/team-config/service.test.ts
git commit -m "feat(team-config): trust states, accepted snapshots, review with diff, guarded edits"
```

---

### Task 6: Merged accessors and the share actions

**Files:**
- Create: `src/main/team-config/settings.ts`, `src/main/team-config/settings.test.ts`

**Interfaces:**
- Consumes: `TeamConfigService` (Task 5), merge functions (Task 3), `putItem`/`removeItem` (Task 4).
- Produces:

```ts
export interface TeamSettingsDeps {
  service: TeamConfigService;
  raw: {
    getToolSettings(rootId: string, toolId: string): unknown;
    setToolSettings(rootId: string, toolId: string, value: unknown): void;
    getRunGroups(rootId: string): RunGroup[];
    setRunGroups(rootId: string, groups: RunGroup[]): RunGroup[];
    updateHidden(rootId: string, fn: (h: Hidden) => Hidden): void;
  };
}
export interface TeamSettings {
  getToolSettings(rootId: string, toolId: string): unknown;   // merged for scripts/health/mock; raw for others
  setToolSettings(rootId: string, toolId: string, value: unknown): void; // split back
  origins(rootId: string, toolId: 'scripts' | 'health' | 'mock'): Origins;
  getRunGroups(rootId: string): RunGroup[];
  setRunGroups(rootId: string, groups: RunGroup[]): RunGroup[];
  runGroupOrigins(rootId: string): Record<string, Origin>;
  domains: { merge(settings: DomainsSettings, roots: readonly { id: string; packages: readonly string[] }[]): { settings: DomainsSettings; origins: Record<string, Origin> }; split(next: DomainsSettings, roots: readonly { id: string; packages: readonly string[] }[]): DomainsSettings };
  share(rootId: string, section: TeamSection, key: string): Promise<void>;
  removeShared(rootId: string, section: TeamSection, key: string): Promise<void>;
  resetOverride(rootId: string, section: TeamSection, key: string): void;
  hide(rootId: string, section: TeamSection, key: string): void;
  restore(rootId: string, section: TeamSection, key: string): void;
}
```

Behaviour:
- `getToolSettings` parses the raw local value with the tool's `settingsSchema` (default on failure), merges it with `service.effective(rootId)`, and returns the merged value.
- `setToolSettings` parses `value`, splits it against the effective team content, stores the local part and merges the returned hides into `Project.teamConfig.hidden`.
- When `effective().content` is null, everything passes straight through.
- `share`:
  - finds the item's **local** value by key in the raw local settings (NOT_FOUND if there's none);
  - calls `service.forEdit`, then `putItem`, then `service.acceptOwnWrite`;
  - then removes the local copy, since the merged view now shows the team item: drop the item from local and store.
- `removeShared`: `service.forEdit`, then `removeItem`, then `acceptOwnWrite`.
- `resetOverride`: delete the local item with that key.
- `hide`: add the key to hidden. `restore`: remove it.
- Each action ends with `service.refresh`, then `emit`.

- [ ] **Step 1: Write the failing test** `src/main/team-config/settings.test.ts`. Use a real `createTeamConfigService` with in-memory file access (as in Task 5's test, factored into `src/main/team-config/test-helpers.ts`), plus an in-memory `raw`. Cover:
  - With an accepted file defining command `api`, `getToolSettings('r1','scripts').commands` includes `api` and `origins(...).commands['#api'] === 'team'`.
  - `setToolSettings` with `api` edited stores only the override locally.
  - `setToolSettings` with `api` deleted stores a hide, and `getToolSettings` no longer shows it; `restore` brings it back.
  - `share('r1','commands','#mine')` writes `mine` into the file, removes it from local, and the state stays `accepted` (auto-accept).
  - `share` while `pending` → VALIDATION; with no local item → NOT_FOUND.
  - `removeShared('r1','commands','#api')` removes it from the file.
  - `resetOverride` drops the local override, so the team version shows again.
  - Run groups: the same, with key = name.
  - **Review Focus 2:** after the file changes to remove the `Full stack` run group, `getRunGroups` still returns it (state `changed`, snapshot used).
  - Domains: `merge` adds a team name for `packages/api` under `workspaceId('r1','packages/api')` with origin `team`; `split` drops a value equal to the team's.

- [ ] **Step 2: Run it to verify it fails**, then implement `settings.ts`.

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run src/main/team-config`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/team-config
git commit -m "feat(team-config): merged settings for tools, run groups and domains; share, remove, reset, hide, restore"
```

---

### Task 7: Channels, wiring and cleanup

**Files:**
- Modify: `src/shared/ipc-names.ts`, `src/shared/channels.ts`, `src/shared/client.ts`, `src/main/ipc/core-handlers.ts`, `src/main/ipc/core-handlers.test.ts`, `src/main/index.ts`, `src/main/projects/project-service.ts` (+ its test)

**Interfaces:**
- Consumes: Tasks 1, 5, 6.
- Produces:
  - channels `teamConfig:status|review|accept|ignore|unignore|share|removeShared|resetOverride|hide|restore`;
  - the event `teamConfig:changed` (payload `{ projectId }`, validated in the renderer);
  - `api.teamConfig.*` in the client.

- [ ] **Step 1: Channels.**
  - In `ipc-names.ts`, add the ten names to `INVOKE_CHANNELS` and `'teamConfig:changed'` to `EVENT_CHANNELS`.
  - In `channels.ts`:
    - `status`, `review`, `ignore`, `unignore`: `TeamProjectInputSchema`. Outputs: `TeamStatusSchema` for status, ignore and unignore; `TeamReviewSchema` for review.
    - `accept`: `TeamAcceptInputSchema` → `TeamStatusSchema`.
    - the five item channels: `TeamItemInputSchema` → `TeamStatusSchema`.
  - In `client.ts`, add `teamConfig: { status(projectId), review(projectId), accept(projectId, hash), ignore(projectId), unignore(projectId), share(projectId, section, key), removeShared(...), resetOverride(...), hide(...), restore(...) }`.
  - `projectId` may be a workspace id: handlers use `splitProjectId(projectId).rootId`.

- [ ] **Step 2: Core handlers** (`core-handlers.ts`): add `teamConfig: { service: TeamConfigService; settings: TeamSettings }` to `CoreHandlerDeps`, and handlers that map `projectId` → `rootId` and call through. The item actions return `service.status(rootId)` after the action. In `core-handlers.test.ts`, add fakes and one test per channel that it passes the root id. `register.test.ts` and `channels.test.ts` then check the names.

- [ ] **Step 3: Wiring in `src/main/index.ts`.**
  - Create the service after `projects`:
    - `file`: a `createVersionedFiles({ allowName: (n) => n === TEAM_FILE, maxBytes: TEAM_FILE_MAX_BYTES, noun: 'team config' })` adapter. `read` returns null on NOT_FOUND, and `symlink` comes from `lstat`.
    - `project`: get/update through `store.updateProjects` on `teamConfig`; `readOnly` is the store's read-only flag.
    - `snapshots`: atomic JSON files in `join(app.getPath('userData'), 'team-config')`.
    - `watch`: `watchDir`.
    - `emit`: `emit('teamConfig:changed', { projectId: rootId })` for the window.
    - Call `service.start()` after `projects.init()` resolves, and `refresh(rootId)` from `ProjectService` on add/refresh: extend `onChanged`, or add `onProjectAdded`/`onRefreshed` hooks if they exist.
  - Create `teamSettings` from the service and the raw `projects.*` accessors.
  - **Replace every settings read with the merged one:**
    - the tool host's `toolSettings: { get, set }` (lines ~409-412) → `teamSettings.getToolSettings` / `setToolSettings`;
    - the Scripts tool's `runGroups.get/set` (~261-264), the tray's `getRunGroups` (~626), and the run-groups `get` near ~348 → `teamSettings.getRunGroups`/`setRunGroups`;
    - `domains` `mainScript` (~176) and the Health process feed (~371) → `teamSettings.getToolSettings`. The Node tool's (~303) can stay raw: no team section.
    - the domains service `settings.get/update` → `teamSettings.domains.merge(...)` / `split(...)`, with roots from `projects.list()` (sync access via the store's projects plus detected workspaces), so team names reach the router.
  - When `teamConfig:changed` fires, also call `domains.refresh()` and `toolHost` event invalidation: emit `projects:changed`, so the renderer invalidates tool queries.
  - Quit: add `teamService.stop()` to `shutdown`.

- [ ] **Step 4: Cleanup on removal.** In `ProjectService.remove`, call a new optional dep `onRemoved(rootId)`. In `index.ts`, it calls `teamService.forget(rootId)`, which closes the watcher and removes the snapshot. `teamConfig` itself goes with the project record. Add a project-service test that `onRemoved` is called.

- [ ] **Step 5: Run everything**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS (apart from the 3 known `win32.integration` failures).

- [ ] **Step 6: Commit**

```bash
git add src/shared src/main
git commit -m "feat(team-config): core channels, wiring through the merged settings, cleanup on removal"
```

---

### Task 8: Origins in tool outputs

**Files:**
- Modify:
  - `src/shared/tools/scripts/contract.ts` + `src/main/tools/scripts/index.ts` (+ tests);
  - `src/shared/tools/health/contract.ts` + `src/main/tools/health/index.ts` (+ tests);
  - `src/shared/tools/mock/contract.ts` + `src/main/tools/mock/index.ts` (+ tests);
  - `src/shared/domains.ts` + `src/main/domains/service.ts` (+ tests).

**Interfaces:**
- Consumes: `TeamSettings.origins`, `runGroupOrigins` and `domains.merge` origins (Task 6), passed to tools through their deps. Add `teamOrigins?: (rootId) => Origins` to each tool factory's deps, wired in `createMainTools`/`index.ts`. Default: `() => ({})`.
- Produces (renderer-visible, all optional, so old fixtures still parse):
  - `ScriptInfoSchema.origin?: Origin` (custom commands only);
  - `PackageScriptsSchema`, or the list output: `runGroupOrigins?: Record<string, Origin>`, `hiddenTeam?: { section: TeamSection; key: string; label: string }[]` (hidden team items with a label, for Restore);
  - `CheckViewSchema.origin?: Origin`;
  - the Mock config output: `origins?: Record<string /* route id */, Origin>`;
  - `RouteSchema` in `src/shared/domains.ts`: `nameOrigin?: Origin`.

- [ ] **Step 1: Write the failing tests:**
  - **Scripts:** with deps `teamOrigins` returning `{ commands: { '#api': 'team' } }` and a merged settings containing `api`, `list` returns the `api` row with `origin: 'team'`.
  - **Scripts, Review Focus 1:** a team command named `dev` in a package whose package.json has a `dev` script. The list shows the npm `dev` row (kind `npm`) and no custom `dev` row. Assert on `kind` and that only one `dev` row exists.
  - **Health:** a check view gets `origin`.
  - **Mock:** `origins` is passed through.
  - **Domains:** a route whose name came from the team has `nameOrigin: 'team'`.
  - **Review Focus 3:** a team command for `package: "packages/gone"` (not detected) isn't listed for any package, and appears under `hiddenTeam` with label "api (package packages/gone not found)". It can never start; `start` → NOT_FOUND.

- [ ] **Step 2: Run them to verify they fail, then implement** in each tool's list/status code. Only add the fields; don't change existing behaviour.

- [ ] **Step 3: Run the tool tests, typecheck and lint**

Run: `pnpm vitest run src/main/tools/scripts src/main/tools/health src/main/tools/mock src/main/domains && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/shared src/main
git commit -m "feat(team-config): origins on commands, run groups, checks, routes and domain names"
```

---

### Task 9: Renderer: banner, review dialog, Team config…

**Files:**
- Create:
  - `src/renderer/team-config/use-team-config.ts` (`useTeamStatus(projectId)`, `useTeamReview(projectId, enabled)`, `useTeamActions(projectId)`, invalidating `['team-config', rootId]` and all `['tools']` queries on `teamConfig:changed`);
  - `TeamBanner.tsx`, `ReviewDialog.tsx`, `TeamConfigDialog.tsx`, with tests.
- Modify: `src/renderer/lib/queries.ts` (`queryKeys.teamConfig(rootId)`), `src/renderer/app/ProjectView.tsx` or `ProjectHeader.tsx` (mount the banner under the header, the menu item "Team config…"), `src/renderer/tools/project-info/OverviewCard.tsx` (the status line).

**Behaviour (spec §4):**
- **Banner:**
  - `pending`: "This repo has a team config (N commands, N run groups, N checks, N routes)" + **Review**.
  - `changed`: "The team config changed (A added, C changed, R removed)" + **Review**.
  - `invalid`: "The team config can't be read: <error>".
  - Nothing for `none`, `accepted` or `ignored`.
- **Review dialog:**
  - sections in this order: Commands (name + full argv in `font-mono`, never truncated, `whitespace-pre-wrap break-all`), Main commands, Env files, Hidden tasks, Run groups (entries and Compose services), Health checks (URL, or env key + path; interval), Mock routes (method, path, status), Domain names;
  - in `changed`, only the diff entries, each with an added/changed/removed badge;
  - warnings listed;
  - buttons **Use team config** (accept with the review's hash; on CONFLICT, refetch the review and show "The file changed; review it again"), **Not now** (close) and **Never for this project** (ignore).
- **Team config… dialog** (project menu): the state, counts, **Review**, **Never for this project** / **Use it again** (unignore), and a read-only note when `readOnly`.
- **Project info line:** "Team config: accepted · N items", or "pending review" / "changed" / "can't be read" / "ignored". Hidden when `none`.

- [ ] **Step 1: Write the failing tests:**
  - **Banner:** each state's text; Review opens the dialog.
  - **Review dialog:**
    - full command lines are visible: an argv joined with spaces of 200+ characters appears entirely in the DOM;
    - accept sends `{ projectId, hash }`;
    - a CONFLICT shows the message and refetches;
    - Never calls `teamConfig:ignore`;
    - the diff mode shows only changed entries.
  - **Team config… dialog:** unignore.
  - **Project info line.**

- [ ] **Step 2: Run them to verify they fail, implement, and run** `pnpm vitest run --project renderer src/renderer/team-config src/renderer/app src/renderer/tools/project-info`, then typecheck and lint.

- [ ] **Step 3: Commit**

```bash
git add src/renderer
git commit -m "feat(team-config): banner, review dialog with full command lines, Team config dialog"
```

---

### Task 10: Renderer: origin badges and item actions

**Files:**
- Create: `src/renderer/team-config/OriginBadge.tsx`, `src/renderer/team-config/team-item-actions.tsx` (menu items for an item given `{ projectId, section, key, origin }`), with tests.
- Modify: `src/renderer/tools/scripts/ScriptList.tsx`, `RunGroups.tsx`, `src/renderer/tools/health/Panel.tsx`, `src/renderer/tools/mock/Panel.tsx`, `src/renderer/domains/LocalDomainDialog.tsx` (+ their tests).

**Behaviour (spec §3):**
- **Badge:** "team" (`origin === 'team'`), "yours" (`override`); nothing for `local`. Token classes only.
- **Actions** in each item's existing row menu:
  - `local` → **Share with the team**;
  - `override` → **Share my version**, **Reset to team**;
  - `team` → **Hide for me**, **Remove from team config** (a confirm dialog first).
  - Hidden team items list under "Hidden team items" with **Restore**: Scripts uses `hiddenTeam`; Health and Mock show hidden ones when `origins` lists hidden keys.
  - Share actions are disabled with the tooltip "Review the team config first" when the team status is `pending`, `changed` or `invalid`.
  - A VALIDATION or FORBIDDEN error toasts its message; a CONFLICT toasts "The team config changed on disk; try again".
- **Keys:**
  - commands: `itemKey(relPath, name)`;
  - run groups: the name;
  - checks: `itemKey(relPath, id)`;
  - routes: `itemKey(relPath, id)`;
  - domain name: the package relPath, section `domainNames`;
  - Host rewrite: section `rewriteHost`.

- [ ] **Step 1: Write the failing tests:**
  - **ScriptList:**
    - a custom command with `origin: 'team'` shows the "team" badge;
    - its menu has Hide for me and Remove from team config; Remove asks first, then calls `teamConfig:removeShared` with `{ section: 'commands', key: '#api' }`;
    - a local command has Share with the team → `teamConfig:share`;
    - share is disabled while the status is `pending`.
  - **RunGroups:** "yours" badge plus Reset to team → `teamConfig:resetOverride`.
  - **Health/Mock:** badge plus Share.
  - **LocalDomainDialog:** Share the name → `teamConfig:share` with `{ section: 'domainNames', key: 'packages/api' }`.

- [ ] **Step 2: Run them to verify they fail, implement, and run** `pnpm vitest run --project renderer`, then typecheck and lint.

- [ ] **Step 3: Commit**

```bash
git add src/renderer
git commit -m "feat(team-config): team/yours badges and share, reset, hide, remove, restore actions"
```

---

### Task 11: End to end, docs, version

**Files:**
- Create: `e2e/fixtures/team-app/` (`package.json` with a `dev` script that prints and stays alive, and a `.nestbox.json` with one command `hello` → `["node", "-e", "console.log('hello from team')"]` and one run group), `e2e/team-config.spec.ts`
- Modify: `CLAUDE.md`, `README.md`, `package.json` (1.31.0), `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: Write `e2e/team-config.spec.ts`**, modelled on `e2e/scripts.spec.ts` (`launch`, add the project, open Scripts). It checks:
  1. The banner "This repo has a team config" is visible, and the Scripts list has no `hello` row.
  2. Click **Review**: the dialog shows `node -e console.log('hello from team')` in full. Click **Use team config**.
  3. The `hello` row appears with a "team" badge. Start it: the log shows `hello from team`.
  4. Add a local command `mine` through the existing "New command" flow, then **Share with the team**. The file in the copied fixture folder now contains `"name": "mine"`; read it with `readFile`. There's no banner, since the write is auto-accepted.
  5. Write the file on disk with `hello`'s argv changed: the banner says "The team config changed", and starting `hello` still prints `hello from team` (the snapshot is in use).

- [ ] **Step 2: Run** `pnpm build && pnpm e2e team-config.spec.ts`. Expected: PASS. Then run the full `pnpm e2e` once.

- [ ] **Step 3: Docs and version.**
  - `package.json`: `1.31.0`.
  - `CLAUDE.md`:
    - folder table: `team-config/` (parse, merge, writer, service, settings);
    - an IPC line: "Core channels added in v1.31: `teamConfig:*` …";
    - a **Team config (v1.31)** gotcha covering:
      - the file and its caps;
      - the per-section validation;
      - the canonical hash;
      - the trust states and the snapshot;
      - merge keys and rules, and that writes through the merged view never touch the file;
      - the share actions and their refusals;
      - auto-accept of own writes;
      - the privacy rule (repo content shown, never logged);
      - that tools only add origins.
  - `README.md`: a feature row "**Team config**" and `| v1.31.0 | Team config in .nestbox.json |` under Shipped; remove it from Planned if listed.
  - `HANDOFF.md`: the current state.

- [ ] **Step 4: Full verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`
Expected: all pass apart from the 3 known `win32.integration` failures.

- [ ] **Step 5: Commit** (don't push; the controller opens the PR after the final review)

```bash
git add e2e CLAUDE.md README.md package.json docs/superpowers/HANDOFF.md
git commit -m "test(team-config): end to end; docs and 1.31.0"
```

---

## Self-review notes

- **Spec coverage:**

  | Spec section | Tasks |
  | --- | --- |
  | §1 file and validation | 1, 2 |
  | §2 reading, states, storage, review | 5 |
  | §2 merging and writes | 3, 6 |
  | §2 origins | 6, 8 |
  | §2 where the layer sits | 7 |
  | §3 sharing and writing | 4, 6 |
  | §3 refusals | 5, 6 |
  | §4 UI | 9, 10 |
  | §4 channels | 7 |
  | §4 errors | 2, 5, 6 |
  | §4 logs | 5 |
  | §5 tests | each task |
  | Delivery | 11 |

- **Types:**
  - section and key names are the same in Tasks 1, 3, 4, 6, 8 and 10 (`TEAM_SECTIONS`, `itemKey`);
  - `TeamConfigService` (Task 5) is consumed by Tasks 6 and 7;
  - `TeamSettings` (Task 6) is consumed by Tasks 7 and 8.
- **Deliberately left to the implementer** (checked against code that exists, not missing design):
  - ProjectService hook names (Task 7);
  - component internals of the Scripts, Health and Mock panels (Task 10);
  - the e2e locators copied from existing specs (Task 11).
