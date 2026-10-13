# EF Core commands in the Database tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** an EF Core card in a .NET package's Database tab that lists, adds, applies, rolls back, scripts and removes migrations through `dotnet ef`, inside NestBox, with output in the Database log only.

**Architecture:**
- **Detection:** `DotnetInfo.efDesign` (a PackageReference).
- **Pure modules:** `ef-project.ts` (finds the tool and the DbContexts), `ef-parse.ts` (EF's prefixed output, the migration list) and `ef-command.ts` (builds the arguments, decides the confirmations).
- **Handlers:** the Database tool's `start` is generalised to any command line. A new `ef` handler shares Prisma's single command slot, log and Stop. `status` gains `ef`.
- **Renderer:** an `EfCard` with dialogs, a context state in the panel, and a pending count on the overview card.

**Tech Stack:** TypeScript strict, Zod, Vitest, React + TanStack Query, Playwright (Electron).

**Spec:** `docs/superpowers/specs/2026-10-12-nestbox-v2-ef-core-design.md`

## Global Constraints

- **Command line:** `dotnet ef <command> --project <project file> [--context <Name>] --prefix-output -- --environment <Env>`, cwd = the package folder, through `spawnCommand`. Never `--connection`, `--verbose` or `--force`.
- **Child environment:** `DOTNET_ENV` + `ASPNETCORE_ENVIRONMENT` + `DOTNET_ENVIRONMENT` = the picked environment, plus the .NET module's `runEnv` `pathPrepend`.
- **Where EF output goes:** only into the Database log ring buffer. Never into `deps.logger`, the store or the parsed list (which keeps only id, name, applied).
- **Validation:**
  - Environment: `ENVIRONMENT_NAME` (`^[A-Za-z0-9_-]{1,40}$`).
  - Migration name: `^[A-Za-z_][A-Za-z0-9_]{0,99}$`.
  - Migration id: `^\d{14}_[A-Za-z_][A-Za-z0-9_]*$`.
  - Context: one of the found names.
  - Target: `0` or an id from the current list.
- **`confirmed: true`** is required for:
  - `update` when the environment isn't `development` (case-insensitive);
  - any `update` with a target;
  - `remove`.
- **Running:** one command per package (shared with Prisma: CONFLICT). There's a 10-minute cap: `■ stopped after 10 minutes`.
- **Logs:** `database ef` with `{ projectId, action, code, migrations?, pending? }` only.
- **No tool:** NestBox never installs `dotnet-ef`. `restore` runs only on a click and only for a local tool.
- **Release:** version 1.26.0. TDD, small conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run Prettier only on touched files.

## Review Focus

1. **Several DbContexts:** an action without `context` must use the first found name and pass `--context` (EF fails with "More than one DbContext was found" otherwise). Test: two contexts, `list` without `context`, so the args include `--context A`.
2. **Environment switch with a list on screen:** a list read for Development must not show (or validate a target) for Production. Test: list in Development, then `status({ environment: 'Production' })`, then `ef.migrations === null`, and an `update` with that target is VALIDATION.
3. **The app's own logging between `data:` lines** (real EF 10 output): it must not break the JSON or be counted as data. Covered by the `ef10-list.txt` fixture test.
4. **A Stop during the follow-up list after add:** the chain must not start a list after a user stop. Test: stop while `add` runs, so there's no second spawn.
5. **A local manifest without `dotnet-ef` and with `isRoot: true` above a global install:** the result is still `global` (the global tool works), but a parent manifest beyond the root one is never read. Test in `ef-project.test.ts`.

---

### Task 1: `efDesign` in .NET detection

**Files:**
- Modify: `src/main/ecosystems/dotnet/detect.ts` (schema plus `parseProjectFile`)
- Test: `src/main/ecosystems/dotnet/detect.test.ts`

**Interfaces:**
- Produces: `DotnetInfo.efDesign: boolean` (Zod default `false`).

- [ ] **Step 1: Write the failing test**

```ts
it('notes the EF Core Design package', () => {
  const xml = '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.0" /></ItemGroup></Project>';
  expect(parseProjectFile(xml).efDesign).toBe(true);
  expect(parseProjectFile('<Project Sdk="Microsoft.NET.Sdk" />').efDesign).toBe(false);
});
```

Also update the existing `toEqual` expectations that list every field (`efDesign: false`).

- [ ] **Step 2:** `pnpm vitest run src/main/ecosystems/dotnet/detect.test.ts`. Expected: FAIL (`efDesign` undefined).
- [ ] **Step 3: Implement.** In the schema, after `dbProviders`:

```ts
  /** References Microsoft.EntityFrameworkCore.Design, which `dotnet ef` needs. */
  efDesign: z.boolean().default(false),
```

In `parseProjectFile`, widen the `Pick` to include `'efDesign'` and return `efDesign: packages.some((p) => /^Microsoft\.EntityFrameworkCore\.Design$/i.test(p))`. The solution-only branch (`project === null`) returns `efDesign: false`.

- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(dotnet): note the EF Core Design package`.

### Task 2: finding the tool and the DbContexts (`ef-project.ts`)

**Files:**
- Create: `src/main/tools/database/ef-project.ts`, `src/main/tools/database/ef-project.test.ts`

**Interfaces:**
- Consumes: `readSmall(path, max)` from `../../ecosystems/dotnet/detect`, `readSourceText(realRoot, abs)` from `../../fs/source-text`.
- Produces:
  - `export type EfTool = 'local' | 'global'`;
  - `findEfTool(dir: string, deps: { commandExists(c: string): Promise<boolean | null>; home: string }): Promise<EfTool | null>`;
  - `findDbContexts(dir: string): Promise<string[]>` (sorted, unique, at most 20).

- [ ] **Step 1: Write the failing tests** (temp folders, like `index.test.ts`):

```ts
describe('findEfTool', () => {
  it('finds a local tool in .config or the folder, here or in a parent', async () => {
    await files({ 'a/.config/dotnet-tools.json': manifest({ 'dotnet-ef': {} }), 'b/dotnet-tools.json': manifest({ 'dotnet-ef': {} }), 'c/d/x.txt': '' });
    await writeFile(join(root, 'c', 'dotnet-tools.json'), manifest({ 'dotnet-ef': {} }));
    const none = { commandExists: async () => false, home: join(root, 'home') };
    expect(await findEfTool(join(root, 'a'), none)).toBe('local');
    expect(await findEfTool(join(root, 'b'), none)).toBe('local');
    expect(await findEfTool(join(root, 'c', 'd'), none)).toBe('local');
  });
  it('stops at an isRoot manifest without dotnet-ef, then falls back to a global tool', async () => {
    await files({ 'dotnet-tools.json': manifest({ 'dotnet-ef': {} }), 'p/dotnet-tools.json': manifest({ other: {} }, true) });
    const none = { commandExists: async () => false, home: join(root, 'home') };
    expect(await findEfTool(join(root, 'p'), none)).toBeNull();
    expect(await findEfTool(join(root, 'p'), { ...none, commandExists: async (c) => c === 'dotnet-ef' })).toBe('global');
    await files({ 'home/.dotnet/tools/dotnet-ef.exe': '' });
    expect(await findEfTool(join(root, 'p'), none)).toBe('global');
  });
  it('treats an unreadable manifest as absent', async () => {
    await files({ 'p/dotnet-tools.json': '{ nope' });
    expect(await findEfTool(join(root, 'p'), { commandExists: async () => false, home: join(root, 'home') })).toBeNull();
  });
});

describe('findDbContexts', () => {
  it('finds classes deriving from a DbContext, skipping abstract ones, comments, bin and obj', async () => {
    await files({
      'Data/Shop.cs': 'public class ShopDbContext(DbContextOptions<ShopDbContext> o) : DbContext(o) { }',
      'Data/Auth.cs': 'namespace A { internal sealed partial class AuthContext : IdentityDbContext<User> { } }',
      'Data/Qualified.cs': 'public class Billing : My.Data.AppDbContext { }',
      'Data/Base.cs': 'public abstract class AppDbContext : DbContext { }',
      'Data/Commented.cs': '// public class Old : DbContext {}\n/* class Older : DbContext {} */',
      'Data/Other.cs': 'public class Repo : IRepository { }',
      'bin/Debug/Gen.cs': 'class Gen : DbContext {}',
      'obj/Gen2.cs': 'class Gen2 : DbContext {}',
      'Data/Dup.cs': 'partial class ShopDbContext : DbContext {}',
    });
    expect(await findDbContexts(root)).toEqual(['AuthContext', 'Billing', 'ShopDbContext']);
  });
  it('keeps at most 20', async () => {
    await files(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`C${i}.cs`, `class C${String(i).padStart(2, '0')} : DbContext {}`])));
    expect(await findDbContexts(root)).toHaveLength(20);
  });
});
```

`manifest(tools, isRoot = false)` returns `JSON.stringify({ version: 1, isRoot, tools })`.

- [ ] **Step 2:** `pnpm vitest run src/main/tools/database/ef-project.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement:**

```ts
// Where `dotnet ef` comes from and which DbContexts a package has; file contents stay in memory here.
import { realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { glob } from 'tinyglobby';
import { readSmall } from '../../ecosystems/dotnet/detect';
import { readSourceText } from '../../fs/source-text';

export type EfTool = 'local' | 'global';

const MANIFEST_MAX = 64 * 1024;
const MANIFESTS = [join('.config', 'dotnet-tools.json'), 'dotnet-tools.json'];
const MAX_FILES = 2_000;
const MAX_CONTEXTS = 20;

const isFile = (path: string) => stat(path).then((s) => s.isFile(), () => false);

async function readManifest(path: string): Promise<{ ef: boolean; isRoot: boolean } | null> {
  const text = await readSmall(path, MANIFEST_MAX);
  if (text === null) return null;
  try {
    const json: unknown = JSON.parse(text);
    if (typeof json !== 'object' || json === null) return null;
    const { tools, isRoot } = json as { tools?: unknown; isRoot?: unknown };
    const names = typeof tools === 'object' && tools !== null ? Object.keys(tools) : [];
    return { ef: names.some((n) => n.toLowerCase() === 'dotnet-ef'), isRoot: isRoot === true };
  } catch {
    return null;
  }
}

/** A local tool from the nearest manifests (as the dotnet CLI finds them), else a global one, else null. */
export async function findEfTool(dir: string, deps: { commandExists(command: string): Promise<boolean | null>; home: string }): Promise<EfTool | null> {
  walk: for (let current = dir; ; ) {
    for (const name of MANIFESTS) {
      const manifest = await readManifest(join(current, name));
      if (manifest?.ef) return 'local';
      if (manifest?.isRoot) break walk;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if ((await deps.commandExists('dotnet-ef')) === true) return 'global';
  const tools = join(deps.home, '.dotnet', 'tools');
  for (const exe of ['dotnet-ef', 'dotnet-ef.exe']) if (await isFile(join(tools, exe))) return 'global';
  return null;
}

const CLASS = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>{]*>)?\s*(?:\([^)]*\))?\s*:\s*([A-Za-z_][\w.]*)/g;

/** Class names deriving from a …DbContext type in the package's .cs files (no build, no reflection). */
export async function findDbContexts(dir: string): Promise<string[]> {
  const realRoot = await realpath(dir).catch(() => null);
  if (realRoot === null) return [];
  const files = (await glob('**/*.cs', { cwd: dir, dot: false, ignore: ['**/bin/**', '**/obj/**', '**/node_modules/**'] })).sort().slice(0, MAX_FILES);
  const found = new Set<string>();
  for (const rel of files) {
    const text = await readSourceText(realRoot, join(dir, rel));
    if (text === null) continue;
    const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
    for (const match of code.matchAll(CLASS)) {
      const [whole, name = '', base = ''] = match;
      const before = code.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0);
      if (/\babstract\s+(?:\w+\s+)*$/.test(before)) continue;
      if (whole && base.split('.').pop()?.endsWith('DbContext')) found.add(name);
    }
  }
  return [...found].sort().slice(0, MAX_CONTEXTS);
}
```

- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(database): find dotnet-ef and the DbContexts`.

### Task 3: EF output and arguments (`ef-parse.ts`, `ef-command.ts`)

**Files:**
- Create: `src/main/tools/database/ef-parse.ts`, `ef-parse.test.ts`, `ef-command.ts`, `ef-command.test.ts`
- Fixtures (already captured from dotnet-ef 10.0.0 and 8.0.27, CRLF kept by `.gitattributes`): `src/main/tools/database/__fixtures__/ef10-list.txt`, `ef10-list-no-db.txt`, `ef8-list.txt`, `not-restored.txt`

**Interfaces:**
- Produces from `ef-parse.ts`:
  - `efLine(line: string): { data: boolean; text: string }`;
  - `parseMigrationList(data: string[]): EfMigration[] | null`;
  - `mentionsRestore(output: string): boolean`.
- Produces from `ef-command.ts`:
  - `efArgs(o: EfArgsInput): string[]`;
  - `efLabel(args: string[], environment: string): string`;
  - `needsConfirm(action: EfAction, environment: string, target: string | undefined): boolean`.
- `EfMigration`, `EfAction` and the regexes come from the contract (Task 4 adds them; this task defines them in `src/shared/tools/database/contract.ts` first):

```ts
export const EF_ACTIONS = ['list', 'add', 'update', 'script', 'remove', 'restore'] as const;
export type EfAction = (typeof EF_ACTIONS)[number];
export const EF_KINDS = ['ef-list', 'ef-add', 'ef-update', 'ef-script', 'ef-remove', 'ef-restore'] as const;
export const MIGRATION_ID = /^\d{14}_[A-Za-z_][A-Za-z0-9_]*$/;
export const MIGRATION_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;
export const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,199}$/;
export const EfMigrationSchema = z.object({ id: z.string().regex(MIGRATION_ID), name: z.string().regex(MIGRATION_NAME), applied: z.boolean().nullable() });
export type EfMigration = z.infer<typeof EfMigrationSchema>;
```

- [ ] **Step 1: Write the failing tests:**

```ts
const fixture = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const dataOf = (text: string) => text.split(/\r?\n/).map(efLine).filter((l) => l.data).map((l) => l.text);

describe('efLine', () => {
  it("strips EF's 9-character prefixes and leaves the app's logging alone", () => {
    expect(efLine('info:    Build started...')).toEqual({ data: false, text: 'Build started...' });
    expect(efLine('error:   The migration has already been applied')).toEqual({ data: false, text: 'The migration has already been applied' });
    expect(efLine('data:      "id": "x",')).toEqual({ data: true, text: '  "id": "x",' });
    expect(efLine('data:')).toEqual({ data: true, text: '' });
    expect(efLine('info: Microsoft.EntityFrameworkCore.Database.Command[20101]')).toEqual({ data: false, text: 'info: Microsoft.EntityFrameworkCore.Database.Command[20101]' });
  });
});

describe('parseMigrationList', () => {
  it('reads EF 10 output with SQL logging in between', () => {
    expect(parseMigrationList(dataOf(fixture('ef10-list.txt')))).toEqual([
      { id: '20261012151146_Init', name: 'Init', applied: true },
      { id: '20261012151151_AddOrders', name: 'AddOrders', applied: false },
    ]);
  });
  it('keeps applied null when EF could not reach the database, and reads EF 8', () => {
    expect(parseMigrationList(dataOf(fixture('ef10-list-no-db.txt')))?.map((m) => m.applied)).toEqual([null, null]);
    expect(parseMigrationList(dataOf(fixture('ef8-list.txt')))).toHaveLength(2);
  });
  it('drops bad rows, refuses non-JSON and caps at 1,000', () => {
    expect(parseMigrationList(['[{"id":"nope","name":"X","applied":true},{"id":"20260101000000_A","name":"A","applied":false}]'])).toEqual([{ id: '20260101000000_A', name: 'A', applied: false }]);
    expect(parseMigrationList(['not json'])).toBeNull();
    expect(parseMigrationList(['{"id":1}'])).toBeNull();
    const many = Array.from({ length: 1_200 }, (_, i) => ({ id: `2026010100${String(i).padStart(4, '0')}_M${i}`, name: `M${i}`, applied: false }));
    expect(parseMigrationList([JSON.stringify(many)])).toHaveLength(1_000);
  });
});

it('recognises the not-restored message', () => {
  expect(mentionsRestore(fixture('not-restored.txt'))).toBe(true);
  expect(mentionsRestore('Build failed.')).toBe(false);
});
```

```ts
describe('efArgs', () => {
  const base = { project: 'Shop.Api.csproj', context: null, environment: 'Development', idempotent: true };
  it('builds each command with the project, prefixes and the environment', () => {
    expect(efArgs({ ...base, action: 'list' })).toEqual(['ef', 'migrations', 'list', '--json', '--project', 'Shop.Api.csproj', '--prefix-output', '--', '--environment', 'Development']);
    expect(efArgs({ ...base, action: 'add', name: 'AddOrders', context: 'ShopDbContext' })).toEqual(['ef', 'migrations', 'add', 'AddOrders', '--project', 'Shop.Api.csproj', '--context', 'ShopDbContext', '--prefix-output', '--', '--environment', 'Development']);
    expect(efArgs({ ...base, action: 'update', target: '0' }).slice(0, 4)).toEqual(['ef', 'database', 'update', '0']);
    expect(efArgs({ ...base, action: 'update' }).slice(0, 4)).toEqual(['ef', 'database', 'update', '--project']);
    expect(efArgs({ ...base, action: 'script' }).slice(0, 4)).toEqual(['ef', 'migrations', 'script', '--idempotent']);
    expect(efArgs({ ...base, action: 'script', idempotent: false }).slice(0, 4)).toEqual(['ef', 'migrations', 'script', '--project']);
    expect(efArgs({ ...base, action: 'remove' }).slice(0, 3)).toEqual(['ef', 'migrations', 'remove']);
    expect(efArgs({ ...base, action: 'restore' })).toEqual(['tool', 'restore']);
  });
  it('never passes --connection, --verbose or --force', () => {
    for (const action of EF_ACTIONS) {
      const args = efArgs({ ...base, action, name: 'X', target: '0' });
      for (const flag of ['--connection', '--verbose', '-v', '--force', '-f']) expect(args).not.toContain(flag);
    }
  });
});

it('labels a run without its project file', () => {
  expect(efLabel(efArgs({ project: 'Shop.Api.csproj', context: null, environment: 'Production', idempotent: true, action: 'list' }), 'Production')).toBe('dotnet ef migrations list --json (Production)');
});

describe('needsConfirm', () => {
  it('asks for updates outside Development, any rollback and remove', () => {
    expect(needsConfirm('update', 'Development', undefined)).toBe(false);
    expect(needsConfirm('update', 'development', undefined)).toBe(false);
    expect(needsConfirm('update', 'Production', undefined)).toBe(true);
    expect(needsConfirm('update', 'Development', '0')).toBe(true);
    expect(needsConfirm('remove', 'Development', undefined)).toBe(true);
    for (const a of ['list', 'add', 'script', 'restore'] as const) expect(needsConfirm(a, 'Production', undefined)).toBe(false);
  });
});
```

- [ ] **Step 2:** `pnpm vitest run src/main/tools/database/ef-parse.test.ts src/main/tools/database/ef-command.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `ef-parse.ts`:

```ts
// EF Core's --prefix-output lines and its `migrations list --json` result. Output stays in memory: only the
// list's ids, names and applied flags leave this module.
import { EfMigrationSchema, type EfMigration } from '@shared/tools/database/contract';

const PREFIXES = ['error:   ', 'warn:    ', 'info:    ', 'data:    ', 'verbose: '];
const MAX_MIGRATIONS = 1_000;

/** A line without EF's prefix; data lines are EF's result (JSON, SQL). The app's own logging has no prefix. */
export function efLine(line: string): { data: boolean; text: string } {
  for (const prefix of PREFIXES) {
    if (line.startsWith(prefix) || line === prefix.trimEnd()) return { data: prefix.startsWith('data'), text: line.slice(prefix.length) };
  }
  return { data: false, text: line };
}

export function parseMigrationList(data: string[]): EfMigration[] | null {
  let json: unknown;
  try {
    json = JSON.parse(data.join('\n'));
  } catch {
    return null;
  }
  if (!Array.isArray(json)) return null;
  return json.flatMap((row: unknown) => {
    const parsed = EfMigrationSchema.safeParse(row);
    return parsed.success ? [{ id: parsed.data.id, name: parsed.data.name, applied: parsed.data.applied }] : [];
  }).slice(0, MAX_MIGRATIONS);
}

/** The local tool manifest names dotnet-ef but it isn't restored yet. */
export const mentionsRestore = (output: string): boolean => output.includes('dotnet tool restore');
```

`ef-command.ts`:

```ts
// The `dotnet ef` command lines NestBox builds: plain words and validated values only (safe through cmd.exe).
import type { EfAction } from '@shared/tools/database/contract';

export interface EfArgsInput {
  action: EfAction;
  project: string;
  context: string | null;
  environment: string;
  name?: string;
  target?: string;
  /** False when SQLite is the only provider: EF can't script it idempotently. */
  idempotent: boolean;
}

function command(o: EfArgsInput): string[] {
  switch (o.action) {
    case 'list': return ['migrations', 'list', '--json'];
    case 'add': return ['migrations', 'add', o.name ?? ''];
    case 'update': return ['database', 'update', ...(o.target === undefined ? [] : [o.target])];
    case 'script': return ['migrations', 'script', ...(o.idempotent ? ['--idempotent'] : [])];
    case 'remove': return ['migrations', 'remove'];
    case 'restore': return [];
  }
}

export function efArgs(o: EfArgsInput): string[] {
  if (o.action === 'restore') return ['tool', 'restore'];
  return ['ef', ...command(o), '--project', o.project, ...(o.context === null ? [] : ['--context', o.context]), '--prefix-output', '--', '--environment', o.environment];
}

/** `▸` line text: the command up to its options, then the environment. */
export function efLabel(args: string[], environment: string): string {
  const end = args.indexOf('--project');
  const words = end === -1 ? args : args.slice(0, end);
  return args[0] === 'ef' ? `dotnet ${words.join(' ')} (${environment})` : `dotnet ${words.join(' ')}`;
}

export function needsConfirm(action: EfAction, environment: string, target: string | undefined): boolean {
  if (action === 'remove') return true;
  if (action !== 'update') return false;
  return target !== undefined || environment.toLowerCase() !== 'development';
}
```

- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(database): EF Core output parsing and command lines`.

### Task 4: contract, status and the `ef` handler

**Files:**
- Modify: `src/shared/tools/database/contract.ts`, `src/main/tools/database/index.ts`, `src/main/index.ts` (deps: `home`), `src/main/processes/process-manager.ts` (export `withPathFirst`)
- Test: `src/main/tools/database/index.test.ts`, `src/shared/tools/database/contract.test.ts` (if it exists; otherwise the handler tests cover input validation)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces for the renderer:
  - `DbStatus.ef: { tool: 'local'|'global'|null; contexts: string[]; context: string|null; needsRestore: boolean; migrations: { environment: string; items: EfMigration[] } | null } | null`;
  - `status` input `{ environment?, context? }`;
  - method `ef` with input `EfInput = { action: EfAction; environment: string; context?: string; name?: string; target?: string; confirmed?: boolean }` and output `void`;
  - `running.command` also takes `EF_KINDS`.

- [ ] **Step 1: Contract.** Add the Task 3 exports (if not yet), then:

```ts
export const EfStatusSchema = z.object({
  tool: z.enum(['local', 'global']).nullable(),
  contexts: z.array(z.string()),
  context: z.string().nullable(),
  needsRestore: z.boolean(),
  migrations: z.object({ environment: z.string(), items: z.array(EfMigrationSchema) }).nullable(),
});
export const EfInputSchema = z.strictObject({
  action: z.enum(EF_ACTIONS),
  environment: z.string().regex(ENVIRONMENT_NAME),
  context: z.string().regex(CLASS_NAME).optional(),
  name: z.string().regex(MIGRATION_NAME).optional(),
  target: z.union([z.literal('0'), z.string().regex(MIGRATION_ID)]).optional(),
  confirmed: z.boolean().optional(),
});
export type EfInput = z.infer<typeof EfInputSchema>;
```

- `DbStatusSchema`: `running.command: z.enum([...PRISMA_COMMANDS, 'test-login', ...EF_KINDS]).nullable()`, plus `ef: EfStatusSchema.nullable()`.
- `status` input: add `context: z.string().regex(CLASS_NAME).optional()`.
- `databaseContract`: `ef: { input: EfInputSchema, output: z.void() }`.
- Update `src/renderer/tools/database/fixtures.ts` (`ef: null`) and any test literal of `DbStatus`.

- [ ] **Step 2: Write the failing handler tests** in `index.test.ts`. Add `home` to the deps in `setup` (`home: join(root, 'home')`), plus a helper that writes a .NET EF project:

```ts
const EF_CSPROJ = '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.0" /><PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.0" /></ItemGroup></Project>';
const dotnet = (info: Partial<DotnetInfo> = {}) => ({ prismaSchema: null, ecosystems: [{ id: 'dotnet', info: { solution: null, project: 'Shop.csproj', targetFrameworks: ['net10.0'], isWeb: true, isTest: false, dbProviders: ['postgresql'], efDesign: true, sdk: null, launchProfiles: [{ name: 'http', ports: [5000], environment: 'Development' }], ...info } }] });
async function efProject(contexts = ['ShopDbContext']) {
  await files({ 'Shop.csproj': EF_CSPROJ, 'dotnet-tools.json': JSON.stringify({ version: 1, isRoot: true, tools: { 'dotnet-ef': { version: '10.0.0', commands: ['dotnet-ef'] } } }), ...Object.fromEntries(contexts.map((c) => [`Data/${c}.cs`, `public class ${c} : DbContext {}`])) });
}
```

The tests (each awaits `flushIo()` after the fake child writes and exits, using `fakePlatform`'s child controls as the Prisma tests do):

```ts
describe('database tool: EF Core', () => {
  it('reports the tool, the contexts and no list before one is read', async () => {
    await efProject(['AuthContext', 'ShopDbContext']);
    const { call } = setup(dotnet());
    const s = await call<DbStatus>('status', {});
    expect(s.ef).toEqual({ tool: 'local', contexts: ['AuthContext', 'ShopDbContext'], context: 'AuthContext', needsRestore: false, migrations: null });
  });
  it('is null without the Design package', async () => {
    const { call } = setup(dotnet({ efDesign: false }));
    expect((await call<DbStatus>('status', {})).ef).toBeNull();
  });
  it('lists migrations with the environment set, keeps data lines out of the log, and reads the list', async () => {
    await efProject();
    const { call, spawned, platform } = setup(dotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    const opts = spawned();
    expect(opts?.command).toBe('dotnet');
    expect(opts?.args).toEqual(['ef', 'migrations', 'list', '--json', '--project', 'Shop.csproj', '--prefix-output', '--', '--environment', 'Development']);
    expect(opts?.env).toMatchObject({ ASPNETCORE_ENVIRONMENT: 'Development', DOTNET_ENVIRONMENT: 'Development', DOTNET_NOLOGO: '1' });
    finishChild(platform, 0, readFixture('ef10-list.txt'));
    await flushIo();
    const s = await call<DbStatus>('status', {});
    expect(s.ef?.migrations?.items.map((m) => m.applied)).toEqual([true, false]);
    const log = (await call<LogSnapshot>('getLogs', {})).lines.map((l) => l.text);
    expect(log).toContain('Build succeeded.');
    expect(log.some((t) => t.includes('"id"'))).toBe(false);
    expect(log.at(-1)).toBe('■ done');
  });
  it('passes --context with several contexts', async () => {
    await efProject(['AuthContext', 'ShopDbContext']);
    const { call, spawned } = setup(dotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    expect(spawned()?.args).toContain('--context');
    expect(spawned()?.args[spawned()!.args.indexOf('--context') + 1]).toBe('AuthContext');
  });
  it('refuses an unknown context, an unknown target, a missing name and missing confirmations', async () => {
    await efProject();
    const { call } = setup(dotnet());
    await expect(call('ef', { action: 'list', environment: 'Development', context: 'Nope' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(call('ef', { action: 'update', environment: 'Development', target: '20260101000000_X', confirmed: true })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(call('ef', { action: 'add', environment: 'Development' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(call('ef', { action: 'update', environment: 'Production' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(call('ef', { action: 'remove', environment: 'Development' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(call('ef', { action: 'restore', environment: 'Development' })).resolves.toBeUndefined();
  });
  it('forgets a list read for another environment', async () => {
    await efProject();
    const { call, platform } = setup(dotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    finishChild(platform, 0, readFixture('ef10-list.txt'));
    await flushIo();
    expect((await call<DbStatus>('status', { environment: 'Production' })).ef?.migrations).toBeNull();
    await expect(call('ef', { action: 'update', environment: 'Production', target: '20261012151146_Init', confirmed: true })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('lists again after a successful add, but not after a stop', async () => {
    await efProject();
    const { call, platform } = setup(dotnet());
    await call('ef', { action: 'add', environment: 'Development', name: 'AddOrders' });
    finishChild(platform, 0, 'info:    Done.\n');
    await flushIo();
    expect(vi.mocked(platform.spawnCommand)).toHaveBeenCalledTimes(2);
    finishChild(platform, 0, readFixture('ef10-list.txt'), 1);
    await flushIo();
    await call('ef', { action: 'add', environment: 'Development', name: 'Again' });
    await call('stop', { what: 'command' });
    await flushIo();
    expect(vi.mocked(platform.spawnCommand)).toHaveBeenCalledTimes(3);
  });
  it('is CONFLICT while any command runs', async () => {
    await efProject();
    const { call } = setup(dotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    await expect(call('ef', { action: 'script', environment: 'Development' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('flags a local tool that needs restoring, and never logs EF output', async () => {
    await efProject();
    const { call, platform, logger } = setup(dotnet());
    await call('ef', { action: 'list', environment: 'Development' });
    finishChild(platform, 1, readFixture('not-restored.txt') + 'error:   Password=s3cr3t\n');
    await flushIo();
    expect((await call<DbStatus>('status', {})).ef?.needsRestore).toBe(true);
    expect(JSON.stringify(logger.entries)).not.toContain('s3cr3t');
    expect(JSON.stringify(logger.entries)).not.toContain('restore');
  });
  it('stops a run after 10 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await efProject();
    const { call, platform } = setup(dotnet());
    await call('ef', { action: 'update', environment: 'Development' });
    vi.advanceTimersByTime(10 * 60_000);
    expect(platform.killTree).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
```

`finishChild(platform, code, stdout, n = 0)` takes the nth spawned fake child, writes `stdout` and closes it with `code`. Write it next to `spawned` using whatever `fakePlatform` exposes (see `src/main/processes/fake-child.ts`; the Prisma tests already drive children this way). `readFixture` reads `__fixtures__`. If `createMemoryLogger` names its array differently, use that name.

- [ ] **Step 3:** `pnpm vitest run src/main/tools/database`. Expected: FAIL.
- [ ] **Step 4: Implement** in `index.ts`:
  - **Deps:** `DatabaseToolDeps.home: string` (wired as `homedir()` in `src/main/index.ts`).
  - **State:** gains `migrations: Map<string, { environment: string; items: EfMigration[] }>` (keyed by context, `''` for none) and `needsRestore: boolean`. `command.kind` widens to `PrismaCommand | 'test-login' | EfKind`.
  - **`start`:** generalise to `start(ctx, spawn: { command: string; args: string[]; env: NodeJS.ProcessEnv }, opts: { quiet?; stdin?; label; line?(stream, text): string | null })`. A `line` hook returns the text to log or null to drop it (the EF list keeps its data lines). The output tail is kept up to 64 KiB for `mentionsRestore` (never logged). Prisma callers pass `prismaCommand(...)` plus their env exactly as before.
  - **`dotnetInfo(ctx)`:** returns the parsed `DotnetInfo` or null. `defaultEnvironment(info)` is `info.launchProfiles[0]?.environment ?? 'Production'`. `dotnetConnections` uses both, unchanged otherwise.
  - **`efContext(ctx)`:** `findDbContexts(ctx.project.path)`, cached per project id for 10 s.
  - **`efStatus(ctx, info, environment, requested)`:** returns null unless `info.efDesign && info.project !== null`.
    - `tool = await findEfTool(path, { commandExists: (c) => ctx.platform.commandExists(c), home: deps.home })`;
    - `context = requested && contexts.includes(requested) ? requested : contexts[0] ?? null`;
    - `migrations` = the stored entry for the context, only if its environment equals `environment`.
  - **`status`:** computes `environment = input.environment ?? defaultEnvironment(info)` once and passes it to both parts.
  - **`ef` handler:** the order of checks:
    1. no info / `efDesign` false / no project / no tool → NOT_FOUND;
    2. `restore` with a non-local tool → VALIDATION;
    3. an unknown context → VALIDATION;
    4. `add` without a name → VALIDATION;
    5. an update target that isn't `0` and isn't in the stored list for this environment → VALIDATION;
    6. `needsConfirm` without `confirmed` → VALIDATION (`'Confirm this command first'`);
    7. a command running → CONFLICT.

    Then `runEf(ctx, state, input, contextArg, info)`.
  - **`runEf`:**
    - `contextArg` is `contexts.length > 1 ? context : null`.
    - Build `efArgs` (`idempotent: !(info.dbProviders.length === 1 && info.dbProviders[0] === 'sqlite')`).
    - **Env:** `{ ...(await ctx.platform.resolveShellEnv()), ...DOTNET_ENV, ASPNETCORE_ENVIRONMENT: env, DOTNET_ENVIRONMENT: env }`, then `withPathFirst(env, pathPrepend)` when `dotnetModule.runEnv` (raced against 3 s, errors ignored) gives one.
    - **Lines:** run through `efLine`. For `list`, data lines are collected and dropped from the log; otherwise the stripped text is logged.
    - **Time limit:** a 10-minute timer calls `stopRun` and marks `timedOut`.
    - **On close:**
      - log `■ done` / `■ stopped` / `■ stopped after 10 minutes` / `■ exited with code N` / `■ dotnet could not be started`;
      - for list with code 0, parse the list (null → `■ Couldn't read the migration list`, keep the old list) and store it;
      - `needsRestore = tool === 'local' && code !== 0 && mentionsRestore(output)`, cleared on code 0;
      - `deps.logger.info('database ef', { projectId, action, code: String(code), ...(list ? { migrations: n, pending: p } : {}) })`;
      - clear `state.command`, emit `changed`;
      - for add/update/remove with code 0 and no stop, run `list` with the same environment and context.
  - **`busy`, `dispose`, `forgetProject`:** need no change (they stop `state.command`).
  - **`process-manager.ts`:** `export function withPathFirst`.
- [ ] **Step 5:** `pnpm vitest run src/main/tools/database && pnpm typecheck`. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(database): EF Core commands for .NET packages`.

### Task 5: renderer: the EF Core card

**Files:**
- Create: `src/renderer/tools/database/EfCard.tsx`, `src/renderer/tools/database/EfCard.test.tsx`
- Modify: `use-database.ts` (context in the key, the `ef` mutation), `Panel.tsx` (context state, the card, the log title), `OverviewCard.tsx` (pending), `fixtures.ts`

**Interfaces:**
- Consumes: `DbStatus.ef`, `EfInput`, `MIGRATION_NAME` (Task 4).
- Produces: `useDatabaseStatus(projectId, environment?, context?)`. The query key is `[...databaseStatusKey(projectId), environment ?? null, context ?? null]`. `useDatabaseActions(projectId).ef` is a mutation taking an `EfInput`.

- [ ] **Step 1: Write the failing tests** (in the style of `ConnectionsCard.test.tsx`: a mock bridge that records `ef` inputs and returns a status with `dotnet` plus `ef`):

```ts
const migrations = [
  { id: '20261001000000_Init', name: 'Init', applied: true },
  { id: '20261005000000_AddProducts', name: 'AddProducts', applied: true },
  { id: '20261010000000_AddOrders', name: 'AddOrders', applied: false },
];
function efStatus(patch: Partial<NonNullable<DbStatus['ef']>> = {}, environment = 'Development'): DbStatus { /* dotnetStatus(environment) with ef: { tool: 'local', contexts: ['ShopDbContext'], context: 'ShopDbContext', needsRestore: false, migrations: { environment, items: migrations }, ...patch } */ }

it('lists migrations newest first with applied and pending', async () => { /* rows AddOrders, AddProducts, Init; AddOrders has text 'Pending'; Init has 'Update to here'; the newest applied (AddProducts) has none */ });
it('runs list, script and a Development update without asking', async () => { /* click buttons → inputs { action: 'list', environment: 'Development' } etc. */ });
it('asks before a Production update, a rollback and remove', async () => { /* select Production: Update database opens an alertdialog naming Production; Confirm sends confirmed: true. Update to here on Init: 'Roll the Development database back to Init?'; Remove last: dialog */ });
it('validates the migration name while typing', async () => { /* type '1bad': Add is disabled and the hint shows; 'AddOrders' then Add sends { action: 'add', name: 'AddOrders' } */ });
it('shows a context select with several contexts and passes the pick', async () => { /* contexts ['AuthContext','ShopDbContext']: select ShopDbContext → status input has context: 'ShopDbContext' and ef inputs carry it */ });
it('shows the install hint without a tool and Restore tools when needed', async () => { /* tool null → text 'dotnet tool install dotnet-ef' and no List button; needsRestore → 'Restore tools' sends { action: 'restore' } */ });
it('asks to list before showing migrations', async () => { /* migrations null → 'List migrations to see which are applied.' */ });
it('counts pending migrations on the overview card', async () => { /* DatabaseCard: '1 pending migration' with class text-warn */ });
```

Write each body out in full in `EfCard.test.tsx` (the comments above say exactly what each asserts).

- [ ] **Step 2:** `pnpm vitest run --project renderer src/renderer/tools/database`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - **`use-database.ts`:** add the `context` parameter. The input is `{ ...(environment && { environment }), ...(context && { context }) }`. Add `ef: useMutation({ mutationFn: (input: EfInput) => api.tools.invoke('database', projectId, 'ef', input), onSettled: refresh, onError })`.
  - **`EfCard.tsx`:** `export function EfCard({ projectId, ef, environment, running, onContext }: { projectId: string; ef: NonNullable<DbStatus['ef']>; environment: string; running: DbStatus['running']['command']; onContext(c: string): void })`. A `section aria-label="EF Core"`, with a header (title, `local tool`/`global tool`, and the context `select aria-label="DbContext"` when there are several).
    - **No tool:** the hint `dotnet tool install dotnet-ef` (with a Copy button through `navigator.clipboard`, which the renderer may use for non-secret text; check how other panels copy plain text and use the same).
    - **Buttons:** List migrations, Add migration…, Update database, Script SQL, Remove last, and Stop while `running?.startsWith('ef-')`. They're disabled while `running !== null`.
    - **Restore tools:** shown when `ef.needsRestore`.
    - **List:** a `ul aria-label="Migrations"` newest first. Each `li aria-label={name}` holds a dot plus `Applied`/`Pending`/`Unknown`, the name, and the date from the id (`yyyy-MM-dd HH:mm`). Applied rows other than the newest applied get an "Update to here" button. The list ends with a "Revert all" button. With `migrations === null`, the hint shows.
    - **Dialogs:** the AlertDialogs (titles from the spec) and a Dialog for the name (input `aria-label="Migration name"`, the hint "Letters, digits and _; not starting with a digit", Add disabled until `MIGRATION_NAME` matches).
  - **`Panel.tsx`:**
    - `const [context, setContext] = useState<string>()`, passed to `useDatabaseStatus`. Render `<EfCard>` after `ConnectionsCard` when `status.ef`, with `environment={status.dotnet?.environment ?? 'Production'}`.
    - The log shows when `status.prisma || status.ef`, with `name={status.prisma ? 'Prisma' : 'EF Core'}` and `emptyHint` matching.
    - The "No Prisma" line is unchanged.
  - **`OverviewCard.tsx`:** when `data?.ef?.migrations`, count `applied === false`. If more than 0, show `<p className="text-xs text-warn">N pending migration(s)</p>`. Use whatever amber tone token `labels.ts`/`TONE_TEXT` uses for warnings.
- [ ] **Step 4:** Run the renderer tests and `pnpm typecheck && pnpm lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(database): EF Core card`.

### Task 6: end-to-end, docs and version

**Files:**
- Modify: `e2e/fixtures/fake-dotnet/dotnet.js`, `e2e/fixtures/dotnet-app/src/Shop.Api/Shop.Api.csproj` (the Design reference)
- Create: `e2e/fixtures/dotnet-app/src/Shop.Api/Data/ShopDbContext.cs`, `e2e/fixtures/dotnet-app/dotnet-tools.json`, `e2e/ef-core.spec.ts`
- Modify: `CLAUDE.md`, `README.md`, `HANDOFF.md`, `package.json` (1.26.0)

- [ ] **Step 1: Teach `fake-dotnet` `ef` and `tool restore`.** Its state lives in `.fake-ef.json` in the cwd. It starts with `[{ id: '20261001000000_Init', name: 'Init', applied: true }, { id: '20261005000000_AddProducts', name: 'AddProducts', applied: false }]`.
  - `ef migrations list --json` prints `info:    Build started...`, `info:    Build succeeded.`, then the JSON with every line prefixed `data:    `.
  - `ef migrations add <name>` appends `{ id: '20261012000000_<name>', name, applied: false }` and prints `info:    Done.`.
  - `ef database update [target]` marks everything applied up to the target (`0` = none) and prints `info:    Done.`.
  - `ef migrations remove` drops the last one, or, when it's applied, prints `error:   The migration '<id>' has already been applied to the database.` and exits 1.
  - `ef migrations script` prints `data:    CREATE TABLE ...;`.
  - `tool restore` prints `Tool 'dotnet-ef' (version '10.0.0') was restored.`.

  Every call is already logged to `.fake-dotnet.log`. Update the header comment.
- [ ] **Step 2: Fixture.**
  - Add `<PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.0" />` to `Shop.Api.csproj`.
  - Add `Data/ShopDbContext.cs`: `public class ShopDbContext(DbContextOptions<ShopDbContext> options) : DbContext(options) { }`, in a namespace.
  - Add the root `dotnet-tools.json` (`isRoot: true`, dotnet-ef 10.0.0).
  - Run `pnpm build && pnpm e2e e2e/dotnet.spec.ts e2e/appsettings.spec.ts e2e/connection-strings.spec.ts` to check nothing else changed.
- [ ] **Step 3: Write `e2e/ef-core.spec.ts`** (same setup as `connection-strings.spec.ts`, with the fake-dotnet `pathPrepend`):

```ts
test('EF Core in the Database tab: list, add, a confirmed Production update', async () => {
  // Add project → Shop.Api → Database tab.
  const card = page.getByRole('region', { name: 'EF Core' });
  await expect(card).toContainText('local tool');
  await card.getByRole('button', { name: 'List migrations' }).click();
  const list = card.getByRole('list', { name: 'Migrations' });
  await expect(list.getByRole('listitem', { name: 'AddProducts' })).toContainText('Pending', { timeout: 15_000 });
  await expect(list.getByRole('listitem', { name: 'Init' })).toContainText('Applied');

  await card.getByRole('button', { name: 'Add migration…' }).click();
  const add = page.getByRole('dialog', { name: 'Add migration' });
  await add.getByRole('textbox', { name: 'Migration name' }).fill('AddOrders');
  await add.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(list.getByRole('listitem', { name: 'AddOrders' })).toContainText('Pending');

  await page.getByRole('region', { name: 'Connections' }).getByRole('combobox', { name: 'Environment' }).selectOption('Production');
  await card.getByRole('button', { name: 'List migrations' }).click();
  await card.getByRole('button', { name: 'Update database' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Production');
  await confirm.getByRole('button', { name: 'Update' }).click();
  await expect(list.getByRole('listitem', { name: 'AddOrders' })).toContainText('Applied', { timeout: 15_000 });

  const calls = await readFile(join(api, '.fake-dotnet.log'), 'utf8');
  expect(calls).toContain('ef migrations add AddOrders --project Shop.Api.csproj --prefix-output -- --environment Development');
  expect(calls).toContain('ef database update --project Shop.Api.csproj --prefix-output -- --environment Production');
  expect(calls).not.toContain('--connection');
  await expect(page.getByLabel('Log of EF Core', { exact: true })).toContainText('Build succeeded.');
});
```

Check how `LogView` labels itself (`Log of <name>` in `ci.spec.ts`) and adjust the locator.

- [ ] **Step 4:** `pnpm build && pnpm e2e e2e/ef-core.spec.ts`. Expected: PASS. Then the full `pnpm e2e`.
- [ ] **Step 5: Docs.**
  - **CLAUDE.md:** a "Database: EF Core (v1.26)" gotcha summarising the spec (conditions, command line, env, output, confirmations, one slot, 10 min, restore).
  - **README:** the Database row mentions EF Core migrations; a v1.26.0 roadmap row; Planned links #45.
  - **HANDOFF.md:** current state.
  - **`package.json`:** `"version": "1.26.0"`.
- [ ] **Step 6:** `pnpm lint && pnpm typecheck && pnpm test`. Expected: PASS (except the known local `win32.integration.test.ts` failures).
- [ ] **Step 7:** Commit: `docs: EF Core commands in the Database tool (1.26.0)` (with the e2e files: `test(e2e): EF Core in the Database tab` as its own commit first).
