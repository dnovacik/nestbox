# ConnectionStrings in the Database tool Implementation Plan (1.25.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Connections card in the Database tab of a .NET package: each `ConnectionStrings:<Name>` for a picked environment, described (provider, host, port, database) and checked for reachability.

**Architecture:**
- **Parser:** `tools/database/ado.ts` turns one connection string into a `DbTarget` plus an optional skip reason, keeping only address keys. URLs go to the existing `describeUrl`.
- **Reader:** `tools/database/connections.ts` reads the appsettings files through the Env tool's settings file access and `parseConfig`, then overlays the environment file on the base.
- **Status:** the Database `status` handler adds a `dotnet` part.
- **Renderer:** a `ConnectionsCard` with an environment select.

**Tech Stack:** TypeScript, Zod, React + TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-nestbox-v2-connection-strings-design.md` · Issue #41

## Global Constraints

- **Allowed keys:** only `Server`, `Host`, `Data Source`, `DataSource`, `Address`, `Addr`, `Network Address`, `Port`, `Database`, `Initial Catalog`, `Filename` are read from a connection string. Everything else is dropped in `ado.ts`.
- **Never:** connection-string values, users or passwords in results, logs or stored state. Names are shown, never logged.
- **Default ports:** postgresql 5432, sqlserver 1433, mysql 3306, mongodb 27017.
- **Caps:** at most 20 connections, `truncated` past that.
- **Environments:** `ENVIRONMENT_NAME`; offered = profile environments, then existing `appsettings.<Name>.json`, then `Production` (no duplicates ignoring case). The default is the first profile's environment, else `Production`.
- **Reach:** `checkReachable` (3 s), in parallel.
- **Logs:** counts and codes only.

## Review Focus

1. **A password containing `;` or `=` inside quotes** (`Password="a;b=c"`) must not leak into the host or the database name. Test in Task 1.
2. **An environment file that sets only some connections:** the others still come from `appsettings.json`, with the base file shown as their source. Test in Task 3.
3. **A .NET package with no ConnectionStrings and no Prisma:** the tab shows the Connections card's empty line and no "No DATABASE_URL" text. Test in Task 5.
4. **An invalid appsettings file** (half-typed JSON) is skipped without failing `status`. Test in Task 3.
5. **Two database providers referenced** (Npgsql and Sqlite, common in tests): the provider comes from the string's keys, not from the first reference. Test in Task 1.

---

### Task 1: describe a connection string (`ado.ts`)

**Files:** Create `src/main/tools/database/ado.ts`, `src/main/tools/database/ado.test.ts`.

**Produces:**
```ts
export type DbProvider = 'postgresql' | 'sqlserver' | 'sqlite' | 'mysql' | 'mongodb';
/** target: never the raw value. skip: why reachability isn't checked (named instance, LocalDB, :memory:), or null. */
export function describeConnectionString(value: string, opts: { providers: readonly DbProvider[]; dir: string }): { target: DbTarget; skip: string | null };
```

- [ ] **Step 1: failing tests**
  - Npgsql `Host=localhost;Port=5433;Database=shop;Username=u;Password=s3cr3t`.
  - A host list `Host=a,b`; `Host=db:6000`.
  - SQL Server `Server=tcp:sql.local,1444;Initial Catalog=Shop;User ID=sa;Password=x`.
  - SQL Server with no port gets 1433; `Server=.\SQLEXPRESS` and `(localdb)\MSSQLLocalDB` are skipped with reasons; `Server=(local)` becomes localhost.
  - MySQL `Server=db;Port=3307;Database=shop;Uid=root;Pwd=x`.
  - SQLite `Data Source=app.db` resolves against `dir`; `:memory:` is skipped.
  - A URL `postgres://u:p@h:1/db` goes to `describeUrl`.
  - Quoted values with `;` and doubled quotes; keys with odd case and spaces.
  - Two referenced providers fall back to key hints; no providers and no hints give `unknown` with the host kept.
  - The secret never appears in `JSON.stringify` of any result.
- [ ] **Step 2:** `pnpm vitest run src/main/tools/database/ado.test.ts` → FAIL.
- [ ] **Step 3:** implement: tokenizer → allowed-key map → provider → address parsing per provider.
- [ ] **Step 4:** pass.
- [ ] **Step 5:** commit `feat(database): describe ADO.NET connection strings`.

### Task 2: database providers from the project file

**Files:** Modify `src/main/ecosystems/dotnet/detect.ts` (+ test). `DotnetInfoSchema` gets `dbProviders: z.array(z.enum(DB_PROVIDERS)).default([])`.

**Produces:** `DB_PROVIDERS` (exported from `detect.ts`), `parseProjectFile(xml).dbProviders`.

- [ ] **Step 1: failing test:** a csproj referencing `Npgsql.EntityFrameworkCore.PostgreSQL` and `Microsoft.EntityFrameworkCore.Sqlite` gives `['postgresql', 'sqlite']`. A commented-out reference doesn't count. A test-only project gives `[]`.
- [ ] **Step 2–4:** implement the package-name table from the spec.
- [ ] **Step 5:** commit `feat(dotnet): database providers from package references`.

### Task 3: read connections for an environment (`connections.ts`)

**Files:** Create `src/main/tools/database/connections.ts` (+ test).

**Produces:**
```ts
export const MAX_CONNECTIONS = 20;
export function environmentsFor(profiles: readonly { environment: string }[], fileNames: readonly string[]): string[];
export async function readConnections(dir: string, files: Pick<ConfigFileAccess, 'list' | 'read'>, environment: string):
  Promise<{ connections: { name: string; file: string; value: string | null }[]; truncated: boolean }>;
```

- [ ] **Step 1: failing tests:**
  - the environment file overrides the base, matched ignoring case, and the source file is shown;
  - a connection only in the base keeps `appsettings.json`;
  - an invalid file is skipped;
  - a non-string value is `value: null`;
  - more than 20 connections are truncated;
  - `environmentsFor` order and de-duplication.
- [ ] **Step 2–4:** implement with `parseConfig`/`leafValue` from `../env/appsettings`. Leaves under `ConnectionStrings:` are one level deep: nested ones are ignored.
- [ ] **Step 5:** commit `feat(database): read ConnectionStrings for an environment`.

### Task 4: status and contract

**Files:** Modify `src/shared/tools/database/contract.ts`, `src/main/tools/database/index.ts` (+ `index.test.ts`), `src/main/index.ts` (deps: `configFiles`).

**Contract:** `status.input = z.strictObject({ environment: z.string().regex(ENVIRONMENT_NAME).optional() })`. `DbStatus.dotnet` is as in the spec; the connection target uses `DbConnectionTargetSchema` (the DbTarget fields without `source`). `appliesTo` also accepts a package with a `dotnet` ecosystem entry whose info has a project file. The info is `unknown` in shared code, so it checks that `(e.info as { project?: unknown }).project` is a string.

- [ ] **Step 1: failing tests:**
  - a .NET project with appsettings gives `dotnet.connections` with targets and reach;
  - `environment` changes the source and target;
  - the default environment is the first profile's;
  - a value's password is absent from the status and from the logs;
  - the logger gets only counts;
  - a Node package gives `dotnet: null`;
  - `appliesTo` is true for a .NET project without env files.
- [ ] **Step 2–4:** implement; reach is `skip ? { result: 'not-checked', reason: skip } : checkReachable(target)`; a null value is `unknown` + `not-checked` "Not a text value".
- [ ] **Step 5:** commit `feat(database): ConnectionStrings in the status`.

### Task 5: renderer

**Files:**
- Create: `src/renderer/tools/database/ConnectionsCard.tsx` (+ test).
- Modify: `use-database.ts` (status key and query take the environment), `Panel.tsx` (card first; Summary only when `prisma !== null || url.state === 'set' || dotnet === null`; no "No Prisma schema" line for .NET), `OverviewCard.tsx` (+ test), `fixtures.ts`.

- [ ] **Step 1: failing tests:**
  - rows show name, label, file and reach;
  - the environment select refetches with `{ environment }`;
  - the empty line;
  - the note;
  - a .NET package without Prisma shows no DATABASE_URL text;
  - the card shows `2 connections · 1 answer` in the err tone when one is refused.
- [ ] **Step 2–4:** implement.
- [ ] **Step 5:** commit `feat(database): Connections card for .NET packages`.

### Task 6: e2e, docs, version

**Files:**
- Modify: `e2e/fixtures/dotnet-app/src/Shop.Api/appsettings.json` (adds `ConnectionStrings:Shop` on a closed port) and `Shop.Api.csproj` (an Npgsql reference).
- Create: `e2e/connection-strings.spec.ts` (writes the Development override with the port of a `net` server it starts).
- Modify: `CLAUDE.md` (Database gotcha), `README.md` (Database row, roadmap row), `docs/superpowers/HANDOFF.md`, `package.json` (1.25.0).

- [ ] **Step 1:** e2e:
  - Development is selected and Shop is Reachable from `appsettings.Development.json`;
  - after switching to Production, Shop is Refused from `appsettings.json`;
  - no password appears on the page.
- [ ] **Step 2:** `pnpm build && pnpm e2e e2e/connection-strings.spec.ts e2e/appsettings.spec.ts e2e/dotnet.spec.ts` pass; then the whole suite.
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test`.
- [ ] **Step 4:** commit `docs: ConnectionStrings in the Database tool (1.25.0)`.
