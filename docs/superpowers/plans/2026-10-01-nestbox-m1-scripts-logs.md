# Nestbox M1 (Scripts and logs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** run, stop and restart `package.json` scripts (root and workspace packages) with process-tree kill, auto-restart and run groups; stream their output into a virtualised log viewer with ANSI and structured JSON modes; keep the app alive in the tray with a state icon, crash notifications and a confirmed quit; clean up orphans after a crash; ship a Settings dialog; land the first real store migration; add Playwright end-to-end tests; and close every M1 follow-up from the M0 reviews.

**Architecture:**
- **`ProcessManager`** (`src/main/processes/`) is a core service with no Electron imports. It owns every child process, its state machine, its ring buffer of log lines and the PID ledger. It spawns and kills only through `PlatformAdapter`.
- **The shell** reads process state through new core channels (`processes:list`, `processes:stopAll`) and the `processes:changed` event. The tray and notifications subscribe to the manager directly in main.
- **The Scripts tool** is a normal tool built on the M0 contract. Its main half is created by a factory that receives the manager, the project service, a save dialog and the shared context. It streams log batches over `tools:event`.
- **The renderer** gets a log viewer under `src/renderer/tools/scripts/`: pure parsers (SGR, structured lines, links), a line store, and virtualised panes.

**Tech stack additions (versions checked 2026-10-01):**

| Area | Packages |
| --- | --- |
| Log list | `@tanstack/react-virtual` 3.14.13 (devDependency; renderer only) |
| End-to-end | `@playwright/test` 1.63.0 (devDependency), using `_electron` |
| shadcn | `dialog`, `switch`, `select` components through the CLI (see the CLAUDE.md shadcn gotchas) |

Nothing new goes in `dependencies`: `tree-kill` is not needed, because `killTree` runs `taskkill` through the adapter.

**Spec:** `docs/nestbox-spec.md` (source of truth), `docs/superpowers/specs/2026-10-01-nestbox-m0-design.md` (M0 design) and `docs/superpowers/specs/2026-10-01-nestbox-m1-design.md` (approved M1 design). Decisions are referred to as "design #n".

## Global Constraints

Everything in `CLAUDE.md` and the M0 plan's Global Constraints still applies. In particular:

- pnpm only. TypeScript strict with `noUncheckedIndexedAccess`; no `any`.
- TDD: the failing Vitest test first, next to the source.
- Conventional commits, small and frequent. Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <the session URL from the current attribution reminder>
  ```
- No `process.platform` outside `src/main/platform/`. No hex colours in `src/renderer/**` outside `globals.css`.
- Never store or log env values, log lines or project file contents. `Logger` fields stay primitive: channel, tool, method, script name, PID, exit code, error code.
- Error messages never contain payload values. Script names are payload values: a `NOT_FOUND` for an unknown script says "Unknown script", not the name.

**M1-specific rules**
- Log text only ever flows main → renderer. The renderer never sends log text back (design #13).
- Every process the manager starts is recorded in the PID ledger before `start` resolves, and removed when it closes.
- A process is never killed on the strength of a PID alone: orphans need a matching start time (design #3).
- No stdin to scripts (design #8).

**Scope**
- Not in M1: the port list and `EADDRINUSE` fix (M2), the command palette and Claude entries (M3), macOS `spawnScript`/`killTree`/`processStartTime` (v2).

## Review Focus

Inputs the design implies but doesn't spell out. Each has a test in the task named.

1. **`taskkill` exits 1 for the killed root.** A user stop must read as `stopped`, never `crashed`. Tested in Task 12.
2. **A script crashes inside the 3 s starting window with auto-restart on**, five times in a row. Expect delays of 1, 2, 4 and 8 s, then "gave up after 5 crashes" and exactly one final crash notification. Tested in Tasks 12 and 21.
3. **Output split mid-line and mid-character** (a UTF-8 `é` split across two chunks, a line with no newline followed by silence, `\r` progress redraws, a 100 KB line). Tested in Task 9.
4. **A recorded PID now belongs to another program** (same PID, different start time), or the ledger file is corrupt. Expect no kill and no crash. Tested in Tasks 11 and 23.
5. **A store written by a newer Nestbox.** Expect read-only mode, no backup and no reset, and `settings:update` failing with `INTERNAL`. Tested in Task 3.
6. **The renderer misses a batch** (pane mounted between snapshot and event, or events arriving before the snapshot resolves). Expect a resync with no duplicate or missing lines. Tested in Task 18.
7. **A run group lists a script that a later package.json no longer has.** Expect the group to start the rest and report the missing entry, not fail the whole group. Tested in Task 16.
8. **Quit while a stop hangs.** Expect the app to quit after 5 s and log the tool ids that didn't finish. Tested in Task 22.

## Refinements to the design

The plan settles some details the design left open. None of them changes a decision.

- `ProcessSummary` gains `gaveUp`, so the UI can say "gave up after 5 crashes" without parsing log lines.
- `setAutoRestart` returns `{ enabled }`. The script list carries `autoRestart` for scripts that never ran.
- `openFileAt` takes `{ path, line }`. The design listed a `column`, but `openInEditor(path, line)` has no column.
- `startRunGroup` returns `{ started, skipped }`, so a missing or already-running entry is reported, not fatal (Review focus 7).
- `RendererTool` gains `fullHeight`, so the Scripts panel can fill the tab without an outer scroll.
- `ProcessManager.restartExisting(projectId, script)` lets the tray restart a process without rebuilding its request.
- The PID ledger keeps the previous session's entries in the file until the orphan prompt is answered, so a second crash loses nothing.
- Notifications use the design's wording in the body, under the title "Nestbox".

## File Map

```text
src/shared/
  processes.ts                 ProcessState, ProcessSummary, LogLine schemas; aggregateState(); matchesProject()
  settings.ts                  SettingsPatchSchema, SettingsViewSchema, EditorCommandSchema
  types.ts                     (modify) schema v2: trayIconTheme, RunGroup entries
  ipc-names.ts                 (modify) settings:*, processes:* channels; processes:changed, app:navigate events
  channels.ts                  (modify) the four new channels
  client.ts                    (modify) settings.*, processes.*
  tool.ts                      (modify) defineEvents, ToolEvents
  tools/index.ts               (modify) register scripts contract + events
  tools/scripts/contract.ts    Scripts ToolDefinition, contract, events
src/main/
  index.ts                     (modify) wiring: window first, tray, quit controller, orphan check, userData override
  lifecycle/quit-controller.ts graceful quit + close-to-tray decisions (no Electron imports)
  lifecycle/orphans.ts         findOrphans()
  ipc/router.ts                (modify) payload size limit, throwing sender check
  ipc/core-handlers.ts         (modify) settings and processes channels, remove stops processes
  security/harden.ts           (modify) hardenAllWebContents()
  store/migrations.ts          (modify) v1 → v2
  store/store-service.ts       (modify) read-only paths, updateSettings, isReadOnly
  projects/project-service.ts  (modify) lazy init, in-flight dedupe, run groups and tool settings accessors
  platform/adapter.ts          (modify) CommandRunner.exec/spawn, processStartTime
  platform/command-runner.ts   (modify) exec and spawn implementations
  platform/win32.ts            (modify) spawnScript, killTree, processStartTime, editor pre-check
  platform/darwin.ts           (modify) processStartTime stub
  processes/ring-buffer.ts     fixed-capacity line buffer with seq lookups
  processes/line-splitter.ts   streaming UTF-8 line splitter
  processes/process-manager.ts the state machine
  processes/pid-ledger.ts      processes.json, atomic writes
  processes/throttle.ts        trailing throttle for processes:changed
  tools/types.ts               (modify) ToolContext.settings
  tools/tool-host.ts           (modify) settings in context, disposeAll(timeout) with logging
  tools/index.ts               (modify) createMainTools(deps)
  tools/scripts/index.ts       createScriptsTool(deps)
  tools/scripts/log-batcher.ts 50 ms batches per (project, script)
  tools/scripts/export.ts      lines → plain text without ANSI
  tray/tray-menu.ts            buildTrayMenu(model, actions) (pure)
  tray/tray-controller.ts      Electron Tray wiring
  tray/crash-notifier.ts       notification text and click routing
src/preload/                   unchanged code; the new names come from ipc-names.ts
src/renderer/
  lib/queries.ts               (modify) processes, settings hooks; projects:changed invalidation
  lib/tool-events.ts           useToolEvent()
  lib/navigate.ts              useNavigateSubscription()
  state/ui-store.ts            (modify) script panes per project
  app/Sidebar.tsx              (modify) state dots, filtered count, no-matches row
  app/StatusBar.tsx            (modify) running count, read-only warning
  app/ProjectHeader.tsx        (modify) Stop all, remove dialog count
  app/TitleBar.tsx             (modify) Settings gear
  app/SettingsDialog.tsx       the Settings dialog
  app/ToolTabs.tsx             (modify) full tabs pattern
  app/ProjectView.tsx          (modify) tabpanel wrapper
  components/StateDot.tsx      shared dot
  tools/project-info/OverviewCard.tsx (modify) skeleton and error
  tools/scripts/ansi.ts        SGR parser
  tools/scripts/structured.ts  pino / NestJS line parser
  tools/scripts/links.ts       file:line detection
  tools/scripts/line-store.ts  LogLineStore (snapshot + events + resync)
  tools/scripts/use-log-stream.ts
  tools/scripts/use-scripts.ts data hooks
  tools/scripts/LogPane.tsx    virtualised pane + toolbar
  tools/scripts/LogRow.tsx     plain and structured rows
  tools/scripts/ScriptList.tsx
  tools/scripts/RunGroups.tsx  list + editor dialog
  tools/scripts/Panel.tsx
  tools/scripts/OverviewCard.tsx
  tools/scripts/index.ts
  tools/registry.ts, tools/icons.ts (modify)
  styles/globals.css           (modify) --ansi-* tokens
e2e/
  playwright.config.ts, fixtures/npm-app/*, scripts.spec.ts
.github/workflows/ci.yml       (modify) e2e job
```

---

### Task 0: Branch and worktree

- [ ] **Step 1:** From the repository root, on an up-to-date `main`:
  ```bash
  git fetch origin main
  git worktree add .worktrees/m1 -b m1-scripts-logs origin/main   # skip -b if the branch exists
  cd .worktrees/m1 && ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile
  pnpm lint && pnpm typecheck && pnpm test
  ```
  Expected: all green (223 tests) before any change.
- [ ] **Step 2:** Every later task runs `pnpm lint && pnpm typecheck && pnpm test` before its commit. A task's commit happens only when all three pass.

---

### Task 1: Router hardening and tool error hygiene

**Files:**
- Modify: `src/main/ipc/router.ts`, `src/main/ipc/router.test.ts`, `src/main/tools/tool-host.test.ts`

**Interfaces:**
- Produces: `MAX_PAYLOAD_CHARS = 2 * 1024 * 1024` (exported from `router.ts`).

- [ ] **Step 1: Write the failing tests** (`router.test.ts`, alongside the existing setup helpers)

```ts
it('fails closed when the sender check throws', async () => {
  const { dispatch, handlers } = setup({
    isTrustedSender: () => {
      throw new Error('bad url');
    },
  });
  const env = await dispatch('projects:list', 'file:///x', undefined);
  expect(env).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender' } });
  expect(handlers['projects:list']).not.toHaveBeenCalled();
});

it('rejects payloads over the size limit before parsing', async () => {
  const { dispatch, handlers } = setup();
  const big = 'x'.repeat(MAX_PAYLOAD_CHARS);
  const env = await dispatch('tools:invoke', TRUSTED, { toolId: 't', projectId: 'p', method: 'm', input: big });
  expect(env).toEqual({ ok: false, error: { code: 'VALIDATION', message: 'Payload too large' } });
  expect(handlers['tools:invoke']).not.toHaveBeenCalled();
});

it('rejects payloads that cannot be measured (cycles, BigInt)', async () => {
  const { dispatch } = setup();
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  expect(await dispatch('projects:add', TRUSTED, cyclic)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(await dispatch('projects:add', TRUSTED, { path: 1n })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
});
```

In `tool-host.test.ts`:

```ts
it('never puts input values in errors or logs when a handler throws', async () => {
  const secret = 'postgres://user:hunter2@db/prod';
  const logger = createMemoryLogger();
  const tool = makeTool({ handlers: { echo: async () => { throw new Error(`boom ${secret}`); } } });
  const host = makeHost({ tools: [tool], logger });
  const router = createRouter({ handlers: coreHandlersWith(host), isTrustedSender: () => true, logger });
  const env = await router('tools:invoke', 'file:///x', { toolId: tool.id, projectId: 'p1', method: 'echo', input: { value: secret } });
  expect(JSON.stringify(env)).not.toContain('hunter2');
  expect(JSON.stringify(logger.entries)).not.toContain('hunter2');
});
```

(`makeTool`, `makeHost` and `coreHandlersWith` are small local helpers. Reuse the existing ones in the file where they exist; `coreHandlersWith(host)` returns a `CoreHandlers` whose `tools:invoke` calls `host.invoke` and whose other handlers are `vi.fn()`.)

- [ ] **Step 2: Run them to see them fail.** Run `pnpm vitest run src/main/ipc src/main/tools`. The `FORBIDDEN` test throws, and the size tests reach the handler.

- [ ] **Step 3: Implement** in `router.ts`:

```ts
export const MAX_PAYLOAD_CHARS = 2 * 1024 * 1024;

/** JSON length of the payload, or null if it cannot be serialised (cycles, BigInt). */
function payloadSize(payload: unknown): number | null {
  if (payload === undefined) return 0;
  try {
    return JSON.stringify(payload)?.length ?? 0;
  } catch {
    return null;
  }
}

function trusted(deps: RouterDeps, url: string): boolean {
  try {
    return deps.isTrustedSender(url);
  } catch {
    return false;
  }
}
```

In the returned dispatcher, use `!trusted(deps, senderUrl)`. Before `run(channel, payload)`, add:

```ts
const size = payloadSize(payload);
if (size === null || size > MAX_PAYLOAD_CHARS) {
  envelope = fail('VALIDATION', size === null ? 'Payload cannot be serialised' : 'Payload too large');
}
```

The tool-host test should already pass, because the router maps non-`NestboxError` throws to `INTERNAL`/"Unexpected error" and logs only `error.name`. If it fails, fix the leak; don't change the test.

- [ ] **Step 4:** Run `pnpm vitest run src/main/ipc src/main/tools`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(ipc): fail closed on sender check errors and bound payload size`

---

### Task 2: Harden every webContents

**Files:**
- Modify: `src/main/security/harden.ts`, `src/main/window.ts`
- Create: `src/main/security/harden.test.ts`

**Interfaces:**
- Produces: `hardenAllWebContents(app: { on(event: 'web-contents-created', cb: (e: unknown, wc: WebContentsLike) => void): unknown }, isAllowedUrl): void`. `hardenWebContents` changes its parameter type to a structural `WebContentsLike` (`on`, `setWindowOpenHandler`), so it can be unit tested.

- [ ] **Step 1: Write the failing test.** Use a fake `app` (an `EventEmitter`) and a fake webContents that records `on` handlers. Emit `web-contents-created` and assert:
  - `will-navigate` to `https://evil.example` is prevented, and to an allowed URL it isn't;
  - `will-redirect` behaves the same;
  - `will-attach-webview` is prevented;
  - `setWindowOpenHandler` returns `{ action: 'deny' }`.
- [ ] **Step 2: Run it to see it fail.** `hardenAllWebContents` doesn't exist.
- [ ] **Step 3: Implement** `hardenAllWebContents` as `app.on('web-contents-created', (_e, wc) => hardenWebContents(wc, isAllowedUrl))`. Remove the direct `hardenWebContents(win.webContents, …)` call from `window.ts`, and drop `isAllowedUrl` from `MainWindowOptions`. `index.ts` calls `hardenAllWebContents(app, isTrusted)` once, before the window is created (Task 6 rewires `index.ts`; make the minimal edit here).
- [ ] **Step 4:** Run `pnpm vitest run src/main/security && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(security): harden every webContents on creation`

---

### Task 3: Store read-only paths and `updateSettings`

**Files:**
- Modify: `src/main/store/migrations.ts`, `src/main/store/store-service.ts`, `src/main/store/store-service.test.ts`, `src/main/store/migrations.test.ts`

**Interfaces:**
- Produces:
  - `class NewerSchemaError extends MigrationError`, thrown by `migrate()` when `version > target`.
  - `StoreService.isReadOnly(): boolean`.
  - `StoreService.updateSettings(fn: (s: AppSettings) => AppSettings): void`, with the same validate-then-persist rule as `updateProjects`.
  - The read-only error is `NestboxError('INTERNAL', 'Settings are read-only; changes cannot be saved')`, used by both update methods.

- [ ] **Step 1: Write the failing tests**

```ts
describe('read-only store', () => {
  it('opens a newer schema read-only without backing it up', () => {
    const newer = { ...defaultStoreData(), schemaVersion: CURRENT_SCHEMA_VERSION + 1, projects: [validProject()] };
    const backend = createMemoryBackend(newer);
    const store = new StoreService(backend, createMemoryLogger());
    expect(store.isReadOnly()).toBe(true);
    expect(backend.backups).toBe(0);
    expect(store.getProjects()).toHaveLength(1); // the file's data is used where it parses
    expect(() => store.updateSettings((s) => ({ ...s, closeToTray: false }))).toThrow(/read-only/);
    expect(backend.data).toEqual(newer); // untouched
  });

  it('falls back to defaults read-only when a newer file does not parse', () => {
    const backend = createMemoryBackend({ schemaVersion: 99, projects: 'nope' });
    const store = new StoreService(backend, createMemoryLogger());
    expect(store.isReadOnly()).toBe(true);
    expect(store.getProjects()).toEqual([]);
  });

  it('goes read-only when writing fresh defaults fails', () => {
    const backend = createMemoryBackend(undefined);
    backend.write = () => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    };
    const logger = createMemoryLogger();
    const store = new StoreService(backend, logger);
    expect(store.isReadOnly()).toBe(true);
    expect(logger.entries).toContainEqual(
      expect.objectContaining({ level: 'warn', message: 'Store unavailable, running read-only' }),
    );
  });

  it('goes read-only when writing after a backup fails', () => { /* invalid data, write throws, assert isReadOnly + backups === 1 */ });

  it('says read-only, not reset, when the backup fails', () => {
    // backupCorrupt throws; assert the warn message is 'Store unavailable, running read-only' with reason 'invalid'
    // and that no entry says 'Store reset to defaults'.
  });
});

describe('updateSettings', () => {
  it('validates and persists', () => { /* closeToTray false → backend.data.settings.closeToTray === false */ });
  it('rejects invalid settings and leaves state untouched', () => { /* logBufferLines: 5 → throws ZodError; getSettings unchanged */ });
});
```

In `migrations.test.ts`, update the "newer version" test to expect `NewerSchemaError`.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement**

In `migrations.ts`:

```ts
export class NewerSchemaError extends MigrationError {
  override name = 'NewerSchemaError';
}
// in migrate():
if (version > target) throw new NewerSchemaError(`Store schemaVersion ${version} is newer than supported ${target}`);
```

In `store-service.ts`:

```ts
private static readonly READ_ONLY = 'Settings are read-only; changes cannot be saved';

isReadOnly(): boolean {
  return this.readOnly;
}

updateSettings(fn: (s: AppSettings) => AppSettings): void {
  this.assertWritable();
  const next = StoreDataSchema.parse({ ...this.data, settings: fn({ ...this.data.settings }) });
  this.backend.write(next);
  this.data = next;
}

private assertWritable(): void {
  if (this.readOnly) throw new NestboxError('INTERNAL', StoreService.READ_ONLY);
}

/** Writes during load. A failure switches to read-only instead of throwing out of the constructor. */
private tryWrite(data: StoreData, reason: string): void {
  try {
    this.backend.write(data);
  } catch (error) {
    this.goReadOnly(reason, error);
  }
}

private goReadOnly(reason: string, error?: unknown): void {
  this.readOnly = true;
  this.logger.warn('Store unavailable, running read-only', {
    reason,
    code: error === undefined ? null : errorCode(error),
  });
}
```

Change `load()` as follows. Leave the transient-read branch as it is, but switch its message and fields to `goReadOnly('unavailable', error)`.

- Empty store: `tryWrite(fresh, 'write-defaults')`.
- Migration: catch `NewerSchemaError` before the generic catch, and handle it like this:

  ```ts
  if (error instanceof NewerSchemaError) {
    this.goReadOnly('newer-schema');
    const parsed = StoreDataSchema.safeParse({ ...(raw as Record<string, unknown>), schemaVersion: CURRENT_SCHEMA_VERSION });
    return parsed.success ? parsed.data : defaultStoreData();
  }
  ```

- After a successful migration: `tryWrite(parsed.data, 'write-migrated')`.

In `reset()`, a failed backup calls `goReadOnly(reason, error)` instead of the old "Store reset to defaults" warning. A successful backup keeps `logger.warn('Store reset to defaults', { reason, backup })`, then calls `tryWrite(fresh, 'write-after-backup')`. `updateProjects` uses `assertWritable()`.

- [ ] **Step 4:** Run `pnpm vitest run src/main/store`. Expected: PASS, including the existing tests. Update the old test that expected a newer schema to be reset: it now expects read-only.
- [ ] **Step 5: Commit** `fix(store): run read-only on newer schemas and failed writes; add updateSettings`

---

### Task 4: Schema v2 and the first migration

**Files:**
- Modify: `src/shared/types.ts`, `src/main/store/migrations.ts`, `src/main/store/migrations.test.ts`, every fixture and test that builds a v1 `StoreData`
- Create: `src/main/store/fixtures/v1-store.json`

**Interfaces:**
- Produces, in `src/shared/types.ts`:

```ts
export const TRAY_ICON_THEMES = ['auto', 'dark-taskbar', 'light-taskbar'] as const;
export type TrayIconTheme = (typeof TRAY_ICON_THEMES)[number];

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
```

  - `ProjectSchema.runGroups` becomes `z.array(RunGroupSchema).default([])`.
  - `AppSettingsSchema` gains `trayIconTheme: z.enum(TRAY_ICON_THEMES).default('dark-taskbar')`.
  - `CURRENT_SCHEMA_VERSION = 2`.
- Produces `MIGRATIONS[1]`.

- [ ] **Step 1: Write the fixture and failing tests.** `fixtures/v1-store.json` is a realistic v1 file: two projects, one with `runGroups: [{ name: 'dev', scripts: ['api', 'web'] }]`, and settings without `trayIconTheme`.

```ts
import v1 from './fixtures/v1-store.json';

describe('migration v1 → v2', () => {
  it('adds trayIconTheme and converts run groups to entries', () => {
    const out = migrate(structuredClone(v1), 2) as StoreData;
    expect(out.schemaVersion).toBe(2);
    expect(out.settings.trayIconTheme).toBe('dark-taskbar');
    expect(out.projects[0]?.runGroups).toEqual([
      { name: 'dev', entries: [{ relPath: '', script: 'api' }, { relPath: '', script: 'web' }] },
    ]);
    expect(StoreDataSchema.safeParse(out).success).toBe(true);
  });

  it('keeps an existing trayIconTheme', () => { /* settings.trayIconTheme: 'auto' survives */ });

  it('drops malformed run groups instead of failing the store', () => {
    // runGroups: 'x' → []; a group whose scripts is not an array → dropped; non-string scripts → filtered
  });

  it('migrates a v1 file end to end through StoreService', () => {
    const backend = createMemoryBackend(structuredClone(v1));
    const store = new StoreService(backend, createMemoryLogger());
    expect(store.isReadOnly()).toBe(false);
    expect((backend.data as StoreData).schemaVersion).toBe(2);
  });
});
```

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement**

```ts
const migrateV1toV2: Migration = (data) => {
  const settings = isRecord(data['settings']) ? data['settings'] : {};
  const projects = Array.isArray(data['projects']) ? data['projects'] : [];
  return {
    ...data,
    settings: { trayIconTheme: 'dark-taskbar', ...settings },
    projects: projects.map((p) => {
      if (!isRecord(p)) return p; // validation decides
      const groups = Array.isArray(p['runGroups']) ? p['runGroups'] : [];
      return {
        ...p,
        runGroups: groups.flatMap((g) => {
          if (!isRecord(g) || typeof g['name'] !== 'string' || !Array.isArray(g['scripts'])) return [];
          const scripts = g['scripts'].filter((s): s is string => typeof s === 'string' && s.length > 0);
          return [{ name: g['name'], entries: scripts.map((script) => ({ relPath: '', script })) }];
        }),
      };
    }),
  };
};

export const MIGRATIONS: Readonly<Record<number, Migration>> = { 1: migrateV1toV2 };
```

Update the comment on `MIGRATIONS`. Fix every test helper that hard-codes `schemaVersion: 1` to use `CURRENT_SCHEMA_VERSION`. Fix every fixture that writes `runGroups` with `scripts`.

- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(store): schema v2 with trayIconTheme and package-aware run groups`

---

### Task 5: Settings channels

**Files:**
- Create: `src/shared/settings.ts`, `src/shared/settings.test.ts`
- Modify: `src/shared/ipc-names.ts`, `src/shared/channels.ts`, `src/shared/client.ts`, `src/main/ipc/core-handlers.ts`, `src/main/ipc/core-handlers.test.ts`, `src/renderer/lib/queries.ts`

**Interfaces:**
- Produces:

```ts
// src/shared/settings.ts
export const EditorCommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(260)
  .refine((v) => !/["\r\n\0]/.test(v), { message: 'unsafe-character' });

export const SettingsPatchSchema = z.strictObject({
  closeToTray: z.boolean().optional(),
  trayIconTheme: z.enum(TRAY_ICON_THEMES).optional(),
  logBufferLines: z.number().int().min(1_000).max(1_000_000).optional(),
  editorCommand: EditorCommandSchema.optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const SettingsViewSchema = AppSettingsSchema.extend({ readOnly: z.boolean() });
export type SettingsView = z.infer<typeof SettingsViewSchema>;
```

  - Channels: `'settings:get': { input: NoInput, output: SettingsViewSchema }` and `'settings:update': { input: SettingsPatchSchema, output: SettingsViewSchema }`.
  - Client: `api.settings.get()` and `api.settings.update(patch)`.
  - `CoreHandlerDeps` gains:
    - `settings: Pick<StoreService, 'getSettings' | 'updateSettings' | 'isReadOnly'>`
    - `onSettingsChanged(s: AppSettings): void`
  - Renderer: `queryKeys.settings`, `useSettings()` and `useUpdateSettings()`. The update hook sets the query data on success and shows a toast on error.

- [ ] **Step 1: Write the failing tests**
  - `settings.test.ts`:
    - `EditorCommandSchema` accepts `code`, `C:\Program Files\Microsoft VS Code\bin\code.cmd` and `cursor`;
    - it rejects `code"`, `a\nb`, an empty string and 261 characters;
    - `SettingsPatchSchema` rejects unknown keys (`theme`).
  - `core-handlers.test.ts`:
    - `settings:get` returns the settings plus `readOnly`;
    - `settings:update` merges the patch, persists it, calls `onSettingsChanged` once and returns the view;
    - on a read-only store it rejects with `INTERNAL` and doesn't call `onSettingsChanged`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** the schema file, the channel names (append to `INVOKE_CHANNELS`), the channel specs, the client methods, the handlers and the hooks:

```ts
'settings:get': async () => ({ ...deps.settings.getSettings(), readOnly: deps.settings.isReadOnly() }),
'settings:update': async (patch) => {
  deps.settings.updateSettings((s) => ({ ...s, ...patch }));
  const next = deps.settings.getSettings();
  deps.onSettingsChanged(next);
  return { ...next, readOnly: deps.settings.isReadOnly() };
},
```

  The preload needs no change: it whitelists from `INVOKE_CHANNELS`. Add a `register.test.ts` assertion that the new channels are registered.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ipc): settings:get and settings:update`

---

### Task 6: Window first, lazy detection

**Files:**
- Modify: `src/main/projects/project-service.ts`, `src/main/projects/project-service.test.ts`, `src/main/index.ts`

**Interfaces:**
- `ProjectServiceDeps` gains `logger: Logger`.
- `init(): void` (now synchronous). It starts detection for every stored project in the background with `Promise.allSettled`, and logs failures as `logger.warn('detection failed', { projectId })`.
- `detectAndCache` deduplicates in-flight calls per project id. `list()` and `getDetected` callers awaiting `list()` share the same promise.

- [ ] **Step 1: Write the failing tests**
  - `init()` returns before a never-resolving `detect` settles (use a deferred).
  - `list()` called while init's detection is in flight awaits it, and `detect` is called once per project.
  - One project whose `detect` rejects doesn't stop another's from being cached, and the warning names only the project id.
  - **Test gap from M0, add when detect throws:** `add()` with a rejecting `detect` rejects, stores nothing and doesn't call `onChanged`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**

```ts
private readonly inflight = new Map<string, Promise<DetectedProject>>();

init(): void {
  void Promise.allSettled(this.deps.store.getProjects().map((p) => this.detectAndCache(p))).then((results) => {
    results.forEach((r, i) => {
      if (r.status === 'rejected') this.deps.logger.warn('detection failed', { projectId: this.deps.store.getProjects()[i]?.id ?? null });
    });
  });
}

private detectAndCache(project: Project): Promise<DetectedProject> {
  const running = this.inflight.get(project.id);
  if (running) return running;
  const p = this.deps
    .detect({ id: project.id, path: project.path, name: project.name })
    .then((detected) => {
      if (this.deps.store.getProjects().some((q) => q.id === project.id)) this.detected.set(project.id, detected);
      return detected;
    })
    .finally(() => this.inflight.delete(project.id));
  this.inflight.set(project.id, p);
  return p;
}
```

  Capture the project list once in `init` so the indexes line up. `refresh()` must not reuse a stale in-flight promise: it awaits the in-flight one if present, then starts a fresh detection.

  In `index.ts`, reorder `whenReady` to: store → platform → `ProjectService` (`init()` not awaited) → tool host → router and `registerIpc` → `hardenAllWebContents` → session security → **window**. Everything that can fail independently (tray, orphan check, Task 21 onwards) is started after the window, and each is wrapped so one failure is logged by name and doesn't block the others.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `perf(main): create the window before detection and detect lazily`

---

### Task 7: `CommandRunner.exec`/`spawn` and the editor pre-check

**Files:**
- Modify: `src/main/platform/adapter.ts`, `src/main/platform/command-runner.ts`, `src/main/platform/win32.ts`, `src/main/platform/win32.test.ts`
- Create: `src/main/platform/command-runner.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ExecResult {
  code: number | null;
  stdout: string;
}

export interface PipedSpawnOpts {
  cwd: string;
  env: NodeJS.ProcessEnv;
  verbatim?: boolean;
}

export interface CommandRunner {
  launch(...): Promise<void>; // unchanged
  /** Runs to completion (hidden window, no shell). Rejects only if it cannot start. stdout is capped at 64 KiB. */
  exec(file: string, args: readonly string[], opts?: { timeoutMs?: number }): Promise<ExecResult>;
  /** Long-running child with piped stdout/stderr and ignored stdin, hidden window. */
  spawn(file: string, args: readonly string[], opts: PipedSpawnOpts): ChildProcess;
}
```

- [ ] **Step 1: Write the failing tests**
  - `command-runner.test.ts`, running on every OS with `process.execPath` as the file:
    - `exec(node, ['-e', 'process.stdout.write("hi"); process.exit(3)'])` resolves `{ code: 3, stdout: 'hi' }`;
    - a missing file rejects with `code: 'ENOENT'`;
    - a 200 KB write is capped at 65 536 characters;
    - `timeoutMs: 100` on `setTimeout(()=>{}, 5000)` resolves `{ code: null }` within 2 s.
  - `win32.test.ts` (fake runner; extend `fakeRunner` with `exec` returning a configurable result and recording calls):
    - `openInEditor` runs `exec('where.exe', ['/q', 'code'])` first;
    - when that returns code 1, it rejects with `NOT_FOUND` and the message `Editor command "code" was not found on PATH. Change it in Settings.`, and `launch` isn't called;
    - an editor setting with a path (`C:\Tools\ed it\code.cmd`) runs `where.exe /q "C:\Tools\ed it:code.cmd"` (the `dir:pattern` form; one argument);
    - if `exec` itself rejects (no `where.exe`), the pre-check is skipped and `launch` still runs.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**

```ts
// command-runner.ts
exec(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ code: null, stdout });
    }, opts.timeoutMs ?? 10_000);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < 65_536) stdout = (stdout + chunk).slice(0, 65_536);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout });
    });
  });
},
spawn(file, args, opts) {
  return spawn(file, [...args], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: opts.verbatim ?? false,
  });
},
```

```ts
// win32.ts, inside openInEditor, after validation and before cmdInvocation's launch:
await assertEditorExists(deps.runner, editor);

async function assertEditorExists(runner: CommandRunner, editor: string): Promise<void> {
  const sep = Math.max(editor.lastIndexOf('\\'), editor.lastIndexOf('/'));
  const query = sep === -1 ? editor : `${editor.slice(0, sep)}:${editor.slice(sep + 1)}`;
  let result: ExecResult;
  try {
    result = await runner.exec('where.exe', ['/q', query], { timeoutMs: 5_000 });
  } catch {
    return; // where.exe unavailable: let the launch report failures
  }
  if (result.code !== 0) {
    throw new NestboxError('NOT_FOUND', `Editor command "${editor}" was not found on PATH. Change it in Settings.`);
  }
}
```

  The editor name is a setting, not an IPC payload, so it may appear in the message. Update every fake `CommandRunner` in the test suite with `exec` and `spawn` (`vi.fn()`).
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(platform): exec/spawn runners and a missing-editor pre-check`

---

### Task 8: Windows `spawnScript`, `killTree`, `processStartTime`

**Files:**
- Modify: `src/main/platform/adapter.ts`, `src/main/platform/win32.ts`, `src/main/platform/darwin.ts`, `src/main/platform/win32.test.ts`, `src/main/platform/darwin.test.ts`
- Create: `src/main/platform/win32.integration.test.ts`

**Interfaces:**
- `SpawnOpts` stays `{ cwd, command, args, env }`. The process manager passes `command: 'pnpm'` and `args: ['run', script]`.
- `PlatformAdapter` gains `processStartTime(pid: number): Promise<number | null>`, which returns epoch ms.

- [ ] **Step 1: Write the failing tests** (fake runner)
  - `spawnScript({ cwd: 'C:\\a b', command: 'pnpm', args: ['run', 'dev:api'], env })` calls `runner.spawn('cmd.exe', ['/d', '/s', '/c', '"pnpm ^"run^" ^"dev:api^""'], { cwd: 'C:\\a b', env, verbatim: true })`. Assert with `cmdInvocation('pnpm', ['run', 'dev:api'])` to avoid duplicating escape logic, and add one literal snapshot of the expected string.
  - A script name containing `"` throws `VALIDATION` and `runner.spawn` is not called.
  - `killTree(4321)` runs `exec('taskkill.exe', ['/PID', '4321', '/T', '/F'])`. It resolves for exit codes 0 and 128, and rejects `INTERNAL` "Could not stop the process tree" for code 1 with stdout `ERROR: Access is denied.`.
  - `killTree(0)`, `killTree(-1)` and `killTree(1.5)` throw `VALIDATION` without calling `exec`.
  - `processStartTime(4321)` runs `exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "(Get-Process -Id 4321 -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')"])`.
    - stdout `2026-10-01T10:00:00.1234567Z\r\n` gives `Date.parse('2026-10-01T10:00:00.123Z')`. Trim, and cut fractional digits beyond 3 before parsing.
    - A non-zero code gives `null`, unparseable stdout gives `null`, and an `exec` rejection gives `null`.
  - `darwin.test.ts`: `processStartTime` rejects `NOT_IMPLEMENTED`.
  - `win32.integration.test.ts`, with `describe.runIf(process.platform === 'win32')` (allowed: it's inside `src/main/platform/`):
    - Spawn `node -e "setInterval(()=>{},1000)"` through the real `spawnRunner` and `spawnScript`. The JS has no `"` and goes in as an arg.
    - Read `processStartTime(pid)` and expect it within 10 s of `Date.now()`.
    - `killTree(pid)`, then within 5 s `process.kill(pid, 0)` throws `ESRCH`.
    - Do the same for a tree: `node -e "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setInterval(()=>{},1000)"`. That one has quotes, so write the JS to a temp file and pass its path instead. Record the grandchild's PID from its stdout and assert it is gone too.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**

```ts
spawnScript(opts) {
  const inv = cmdInvocation(opts.command, opts.args);
  return deps.runner.spawn(inv.file, inv.args, { cwd: opts.cwd, env: opts.env, verbatim: true });
},

async killTree(pid) {
  assertPid(pid);
  const { code } = await deps.runner.exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 10_000 });
  // 128: the process no longer exists, which is what we wanted.
  if (code !== 0 && code !== 128) throw new NestboxError('INTERNAL', 'Could not stop the process tree');
},

async processStartTime(pid) {
  assertPid(pid);
  const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`;
  try {
    const { code, stdout } = await deps.runner.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 10_000 });
    if (code !== 0) return null;
    const iso = stdout.trim().replace(/(\.\d{3})\d+/, '$1');
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
},

function assertPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) throw new NestboxError('VALIDATION', 'Invalid process id');
}
```

  `PlatformDeps` is unchanged: `runner` now carries `exec` and `spawn`. Remove the "Stubbed until their milestone" comment for these two methods.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS. The integration test is skipped on Linux and macOS and runs in Windows CI.
- [ ] **Step 5: Commit** `feat(platform): spawn scripts, kill process trees and read start times on Windows`

---
### Task 9: Ring buffer and line splitter

**Files:**
- Create: `src/main/processes/ring-buffer.ts`, `src/main/processes/ring-buffer.test.ts`, `src/main/processes/line-splitter.ts`, `src/main/processes/line-splitter.test.ts`

**Interfaces:**
- Produces:
  - `class RingBuffer<T extends { seq: number }>`:
    - `constructor(capacity: number)`
    - `push(item)`
    - `toArray(): T[]`
    - `after(seq): T[]`
    - `clear()`
    - `get size()`
  - `class LineSplitter`:
    - `push(chunk: Uint8Array | string): string[]`
    - `flush(): string[]`
    - `get hasPending(): boolean`
  - `MAX_LINE_CHARS = 8192` and `MAX_PENDING_CHARS = 65_536`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('RingBuffer', () => {
  const line = (seq: number) => ({ seq });
  it('keeps the newest items up to capacity', () => {
    const b = new RingBuffer<{ seq: number }>(3);
    [1, 2, 3, 4, 5].forEach((s) => b.push(line(s)));
    expect(b.toArray().map((l) => l.seq)).toEqual([3, 4, 5]);
    expect(b.size).toBe(3);
  });
  it('returns items after a seq', () => { /* after(3) → [4,5]; after(0) → all; after(9) → [] */ });
  it('clears', () => { /* size 0, toArray [] */ });
  it('rejects a capacity below 1', () => { expect(() => new RingBuffer(0)).toThrow(); });
});

describe('LineSplitter', () => {
  it('splits on LF and CRLF and holds back a partial line', () => {
    const s = new LineSplitter();
    expect(s.push('a\r\nb\nc')).toEqual(['a', 'b']);
    expect(s.hasPending).toBe(true);
    expect(s.flush()).toEqual(['c']);
    expect(s.hasPending).toBe(false);
  });
  it('keeps only the text after a lone CR (progress redraws)', () => {
    expect(new LineSplitter().push('10%\r50%\r100%\n')).toEqual(['100%']);
  });
  it('decodes multibyte characters split across chunks', () => {
    const bytes = new TextEncoder().encode('café\n');
    const s = new LineSplitter();
    expect(s.push(bytes.slice(0, 4))).toEqual([]);
    expect(s.push(bytes.slice(4))).toEqual(['café']);
  });
  it('truncates long lines with an ellipsis', () => {
    const [out] = new LineSplitter().push('x'.repeat(100_000) + '\n');
    expect(out).toHaveLength(MAX_LINE_CHARS + 1);
    expect(out?.endsWith('…')).toBe(true);
  });
  it('emits an over-long pending line instead of growing without bound', () => {
    const s = new LineSplitter();
    expect(s.push('y'.repeat(MAX_PENDING_CHARS + 10))).toHaveLength(1);
    expect(s.hasPending).toBe(false);
  });
  it('flushes an empty splitter to nothing', () => { expect(new LineSplitter().flush()).toEqual([]); });
});
```

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement**

```ts
// ring-buffer.ts
export class RingBuffer<T extends { seq: number }> {
  private items: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
    this.items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    const index = (this.start + this.count) % this.capacity;
    this.items[index] = item;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const item = this.items[(this.start + i) % this.capacity];
      if (item) out.push(item);
    }
    return out;
  }

  /** Items with seq > `seq`. Seqs increase monotonically, so a binary search would work; a linear scan from the end is enough. */
  after(seq: number): T[] {
    const all = this.toArray();
    let i = all.length;
    while (i > 0 && (all[i - 1]?.seq ?? -Infinity) > seq) i--;
    return all.slice(i);
  }

  clear(): void {
    this.items = new Array<T | undefined>(this.capacity);
    this.start = 0;
    this.count = 0;
  }
}
```

```ts
// line-splitter.ts
export const MAX_LINE_CHARS = 8192;
export const MAX_PENDING_CHARS = 65_536;

function finish(raw: string): string {
  const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  const cr = line.lastIndexOf('\r');
  const visible = cr === -1 ? line : line.slice(cr + 1);
  return visible.length > MAX_LINE_CHARS ? `${visible.slice(0, MAX_LINE_CHARS)}…` : visible;
}

export class LineSplitter {
  private readonly decoder = new TextDecoder('utf-8');
  private pending = '';

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  push(chunk: Uint8Array | string): string[] {
    this.pending += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    const parts = this.pending.split('\n');
    this.pending = parts.pop() ?? '';
    const lines = parts.map(finish);
    if (this.pending.length > MAX_PENDING_CHARS) {
      lines.push(finish(this.pending));
      this.pending = '';
    }
    return lines;
  }

  flush(): string[] {
    this.pending += this.decoder.decode();
    if (this.pending.length === 0) return [];
    const line = finish(this.pending);
    this.pending = '';
    return [line];
  }
}
```

- [ ] **Step 4:** Run `pnpm vitest run src/main/processes`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processes): ring buffer and streaming line splitter`

---

### Task 10: Shared process types

**Files:**
- Create: `src/shared/processes.ts`, `src/shared/processes.test.ts`, `src/shared/ansi-strip.ts`, `src/shared/ansi-strip.test.ts`

**Interfaces:**
- Produces:

```ts
export const PROCESS_STATES = ['starting', 'running', 'stopping', 'stopped', 'exited', 'crashed'] as const;
export type ProcessState = (typeof PROCESS_STATES)[number];

export const LogLineSchema = z.object({
  seq: z.number().int().positive(),
  ts: z.number(),
  stream: z.enum(['stdout', 'stderr', 'system']),
  text: z.string(),
});
export type LogLine = z.infer<typeof LogLineSchema>;

export const LogSnapshotSchema = z.object({
  lines: z.array(LogLineSchema),
  /** seq of the first line held, or lastSeq + 1 when empty. */
  firstSeq: z.number().int().nonnegative(),
  /** Highest seq ever assigned for this script (0 = none). Survives clear. */
  lastSeq: z.number().int().nonnegative(),
});
export type LogSnapshot = z.infer<typeof LogSnapshotSchema>;

export const ProcessSummarySchema = z.object({
  projectId: z.string(),
  script: z.string(),
  state: z.enum(PROCESS_STATES),
  pid: z.number().int().nullable(),
  startedAt: z.number().nullable(),
  exit: z.object({ code: z.number().int().nullable(), signal: z.string().nullable(), lastLine: z.string().nullable() }).nullable(),
  crashCount: z.number().int().nonnegative(),
  autoRestart: z.boolean(),
  nextRestartAt: z.number().nullable(),
  gaveUp: z.boolean(),
});
export type ProcessSummary = z.infer<typeof ProcessSummarySchema>;

export type AggregateState = 'crashed' | 'starting' | 'running' | 'idle';
export function aggregateState(states: Iterable<ProcessState>): AggregateState;
export function isLive(state: ProcessState): boolean;          // starting | running | stopping
/** True when processProjectId is projectId itself or one of its workspace packages. */
export function belongsTo(processProjectId: string, projectId: string): boolean;

export const NavigateSchema = z.object({
  projectId: z.string().min(1),
  tab: z.string().min(1),
  script: z.string().optional(),
});
```

```ts
// ansi-strip.ts — shared by main (export) and renderer (search, structured parsing)
// eslint-disable-next-line no-control-regex -- matching terminal escape sequences is the point
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}
```

- [ ] **Step 1: Write the failing tests**
  - `aggregateState`:
    - `[]` gives `idle`;
    - `['running', 'stopped']` gives `running`;
    - `['running', 'stopping']` gives `starting`;
    - `['starting', 'crashed']` gives `crashed`;
    - `['exited']` gives `idle`.
  - `belongsTo`:
    - `('r1::packages/api', 'r1')` gives `true`;
    - `('r1', 'r1')` gives `true`;
    - `('r10', 'r1')` gives `false` (prefix without the separator);
    - `('r1', 'r1::packages/api')` gives `false`.
  - `stripAnsi`:
    - `\x1b[31mred\x1b[0m` gives `red`;
    - OSC 8 hyperlinks and `\x1b[2K` are removed;
    - plain text is unchanged.
  - `ProcessSummarySchema` parses a full example.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** the functions:

```ts
export function aggregateState(states: Iterable<ProcessState>): AggregateState {
  let starting = false;
  let running = false;
  for (const s of states) {
    if (s === 'crashed') return 'crashed';
    if (s === 'starting' || s === 'stopping') starting = true;
    if (s === 'running') running = true;
  }
  return starting ? 'starting' : running ? 'running' : 'idle';
}
export const isLive = (s: ProcessState): boolean => s === 'starting' || s === 'running' || s === 'stopping';
export const belongsTo = (pid: string, projectId: string): boolean =>
  pid === projectId || pid.startsWith(`${projectId}${WORKSPACE_ID_SEPARATOR}`);
```

- [ ] **Step 4:** Run `pnpm vitest run src/shared`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): process summary, log line and state aggregation`

---

### Task 11: PID ledger and orphan matching

**Files:**
- Create: `src/main/processes/pid-ledger.ts`, `src/main/processes/pid-ledger.test.ts`, `src/main/lifecycle/orphans.ts`, `src/main/lifecycle/orphans.test.ts`

**Interfaces:**
- Produces:

```ts
export const LedgerEntrySchema = z.object({
  pid: z.number().int().positive(),
  /** epoch ms from processStartTime; null when it could not be read (such entries are never killed). */
  startTime: z.number().nullable(),
  projectId: z.string(),
  script: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export interface PidLedger {
  /** Entries left by the previous session, read once at creation. */
  previous(): readonly LedgerEntry[];
  add(entry: LedgerEntry): void;
  remove(pid: number): void;
  /** Forget the previous session's entries and rewrite the file with the current ones (removes it when empty). */
  dropPrevious(): void;
  /** Clean quit: forget everything and remove the file. */
  clear(): void;
}

export interface LedgerFs {
  readFileSync(path: string, enc: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
  renameSync(from: string, to: string): void;
  rmSync(path: string, opts: { force: true }): void;
}

export function createPidLedger(file: string, logger: Logger, fs?: LedgerFs): PidLedger;

// lifecycle/orphans.ts
export const START_TIME_TOLERANCE_MS = 1_000;
export async function findOrphans(
  entries: readonly LedgerEntry[],
  startTimeOf: (pid: number) => Promise<number | null>,
): Promise<LedgerEntry[]>;
```

- [ ] **Step 1: Write the failing tests** (in-memory `LedgerFs` built on a `Map`)
  - `previous()`:
    - a missing file gives `[]`;
    - invalid JSON gives `[]` plus a warning `pid ledger unreadable`;
    - a valid file with one invalid entry keeps the valid ones.
  - `add` then `remove`:
    - the file holds the previous session's entries plus the current ones, written through `<file>.tmp` and a rename;
    - so a second crash before the orphan prompt loses nothing. `dropPrevious()` then rewrites the file with the current entries only.
  - `dropPrevious()` with no current entries removes the file, and `previous()` is then `[]`.
  - `clear()` removes the file.
  - When a write throws `EPERM`, a warning with `code: 'EPERM'` is logged and nothing throws.
  - `findOrphans` (Review focus 4):
    - an entry whose current start time is within 1 s is returned;
    - one 5 s off isn't;
    - `startTime: null` entries are never returned and their `startTimeOf` isn't called;
    - a `startTimeOf` rejection counts as gone.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**

```ts
export function createPidLedger(file: string, logger: Logger, fs: LedgerFs = nodeFs): PidLedger {
  let previous = readEntries();
  let current: LedgerEntry[] = [];

  function readEntries(): LedgerEntry[] {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return parsed.flatMap((e) => {
        const r = LedgerEntrySchema.safeParse(e);
        return r.success ? [r.data] : [];
      });
    } catch {
      logger.warn('pid ledger unreadable');
      return [];
    }
  }

  function persist(): void {
    try {
      if (current.length === 0 && previous.length === 0) {
        fs.rmSync(file, { force: true });
        return;
      }
      // previous is kept in the file until dropPrevious(), so a second crash before the orphan prompt loses nothing.
      fs.writeFileSync(`${file}.tmp`, JSON.stringify([...previous, ...current]));
      fs.renameSync(`${file}.tmp`, file);
    } catch (error) {
      logger.warn('pid ledger write failed', { code: errorCode(error) });
    }
  }

  return {
    previous: () => previous,
    add(entry) {
      current = [...current.filter((e) => e.pid !== entry.pid), entry];
      persist();
    },
    remove(pid) {
      current = current.filter((e) => e.pid !== pid);
      persist();
    },
    dropPrevious() {
      previous = [];
      persist();
    },
    clear() {
      previous = [];
      current = [];
      persist();
    },
  };
}
```

  `nodeFs` wraps `node:fs`. `errorCode` moves from `store-service.ts` to `src/main/error-code.ts` so both files can use it.

```ts
export async function findOrphans(entries, startTimeOf) {
  const checks = await Promise.all(
    entries.map(async (entry) => {
      if (entry.startTime === null) return null;
      const now = await startTimeOf(entry.pid).catch(() => null);
      return now !== null && Math.abs(now - entry.startTime) <= START_TIME_TOLERANCE_MS ? entry : null;
    }),
  );
  return checks.filter((e): e is LedgerEntry => e !== null);
}
```

- [ ] **Step 4:** Run `pnpm vitest run src/main/processes src/main/lifecycle`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(processes): PID ledger with atomic writes and orphan matching`

---

### Task 12: ProcessManager

**Files:**
- Create: `src/main/processes/process-manager.ts`, `src/main/processes/process-manager.test.ts`, `src/main/processes/fake-child.ts` (test helper; not imported by production code), `src/main/processes/process-manager.integration.test.ts`

**Interfaces:**
- Consumes: `PlatformAdapter` (Tasks 7–8), `RingBuffer`/`LineSplitter` (Task 9), the shared process types (Task 10), and `PidLedger` (Task 11).
- Produces:

```ts
export const STARTING_MS = 3_000;
export const HEALTHY_MS = 60_000;
export const STOP_TIMEOUT_MS = 5_000;
export const PARTIAL_FLUSH_MS = 50;
export const MAX_CRASHES = 5;
export const backoffMs = (crashCount: number): number => Math.min(1_000 * 2 ** (crashCount - 1), 30_000);

export interface StartRequest {
  projectId: string;
  script: string;
  cwd: string;
  packageManager: PackageManager | null;
  autoRestart: boolean;
}

export type ProcessEvent =
  | { type: 'changed' }
  | { type: 'line'; projectId: string; script: string; line: LogLine }
  | { type: 'crashed'; summary: ProcessSummary; final: boolean };

export interface ProcessManagerDeps {
  platform: Pick<PlatformAdapter, 'spawnScript' | 'killTree' | 'processStartTime' | 'resolveShellEnv'>;
  ledger: Pick<PidLedger, 'add' | 'remove'>;
  bufferLines(): number;
  logger: Logger;
  now?: () => number;
}

export class ProcessManager {
  constructor(deps: ProcessManagerDeps);
  on(listener: (event: ProcessEvent) => void): () => void;
  list(): ProcessSummary[];
  get(projectId: string, script: string): ProcessSummary | null;
  /** CONFLICT if live. Resolves once the PID is recorded in the ledger (or the spawn failed). */
  start(req: StartRequest): Promise<ProcessSummary>;
  /** NOT_FOUND if unknown. Clears crashed/exited to stopped. Cancels a pending auto-restart. */
  stop(projectId: string, script: string): Promise<ProcessSummary>;
  restart(req: StartRequest): Promise<ProcessSummary>;
  setAutoRestart(projectId: string, script: string, enabled: boolean): void;
  logs(projectId: string, script: string, afterSeq?: number): LogSnapshot;
  clearLogs(projectId: string, script: string): void;
  liveCount(): number;
  stopAll(filter?: (projectId: string) => boolean): Promise<void>;
  /** Drops entries (after stopAll) — used when a project is removed. */
  forget(filter: (projectId: string) => boolean): void;
}
```

`fake-child.ts`:

```ts
export class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid: number | undefined;
  killed = false;
  constructor(pid: number, opts: { failSpawn?: boolean } = {}) {
    super();
    queueMicrotask(() => {
      if (opts.failSpawn) {
        this.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
        this.emit('close', -2, null);
        return;
      }
      this.pid = pid;
      this.emit('spawn');
    });
  }
  kill(): boolean {
    this.killed = true;
    return true;
  }
  /** Ends stdio, then emits close, like a real child. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit('close', code, signal));
  }
}

export function fakePlatform() {
  const children: FakeChild[] = [];
  let nextPid = 1000;
  return {
    children,
    last: () => children.at(-1)!,
    spawnScript: vi.fn((): ChildProcess => {
      const child = new FakeChild(nextPid++);
      children.push(child);
      return child as unknown as ChildProcess;
    }),
    // Like taskkill /F: the root exits with code 1.
    killTree: vi.fn(async (pid: number) => children.find((c) => c.pid === pid)?.exit(1)),
    processStartTime: vi.fn(async () => 1_700_000_000_000),
    resolveShellEnv: vi.fn(async () => ({ PATH: 'x', SECRET: 'do-not-log' })),
  };
}
```

- [ ] **Step 1: Write the failing tests.** Use `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })` so that `setImmediate` and microtasks stay real. Don't use `vi.waitFor`: under fake timers it advances the clock on every check, which breaks the backoff timings. Use `flushIo()` instead: `for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));`, which lets `FakeChild.exit` deliver `close`. Each test builds the manager through a `setup()` that returns `{ pm, platform, ledger, events }`. `events` collects everything from `pm.on`.

```ts
const req = (over: Partial<StartRequest> = {}): StartRequest => ({
  projectId: 'p1', script: 'dev', cwd: 'C:\\shop', packageManager: 'pnpm', autoRestart: false, ...over,
});

it('spawns through the adapter with FORCE_COLOR and the package manager', async () => {
  const { pm, platform } = setup();
  await pm.start(req());
  expect(platform.spawnScript).toHaveBeenCalledWith({
    cwd: 'C:\\shop', command: 'pnpm', args: ['run', 'dev'], env: expect.objectContaining({ FORCE_COLOR: '1', PATH: 'x' }),
  });
});

it('falls back to npm when no package manager was detected', async () => { /* packageManager: null → command 'npm' */ });

it('records the PID with its start time before start resolves', async () => {
  const { pm, ledger } = setup();
  const s = await pm.start(req());
  expect(s).toMatchObject({ state: 'starting', pid: 1000 });
  expect(ledger.add).toHaveBeenCalledWith({ pid: 1000, startTime: 1_700_000_000_000, projectId: 'p1', script: 'dev' });
});

it('promotes starting to running after 3 s', async () => {
  const { pm } = setup();
  await pm.start(req());
  await vi.advanceTimersByTimeAsync(2_999);
  expect(pm.get('p1', 'dev')?.state).toBe('starting');
  await vi.advanceTimersByTimeAsync(1);
  expect(pm.get('p1', 'dev')?.state).toBe('running');
});

it('rejects a second start while live with CONFLICT', async () => { /* expect NestboxError code CONFLICT */ });

it('reads a user stop as stopped even though taskkill exits 1 (Review focus 1)', async () => {
  const { pm, platform, ledger } = setup();
  await pm.start(req());
  const stopped = await pm.stop('p1', 'dev');
  expect(platform.killTree).toHaveBeenCalledWith(1000);
  expect(stopped.state).toBe('stopped');
  expect(stopped.crashCount).toBe(0);
  expect(ledger.remove).toHaveBeenCalledWith(1000);
});

it('classifies exit 0 as exited and non-zero as crashed with the last stderr line', async () => {
  const { pm, platform, events } = setup();
  await pm.start(req());
  platform.last().stdout.write('ready\n');
  platform.last().stderr.write('Error: boom\n');
  platform.last().stdout.write('bye\n');
  platform.last().exit(1);
  await flushIo();
  expect(pm.get('p1', 'dev')?.state).toBe('crashed');
  expect(pm.get('p1', 'dev')?.exit).toEqual({ code: 1, signal: null, lastLine: 'Error: boom' });
  expect(events).toContainEqual(expect.objectContaining({ type: 'crashed', final: true }));
});

it('streams lines with increasing seqs and system markers', async () => {
  // ▸ pnpm run dev, then "hello", then ■ exited with code 0; seqs 1..3; stream fields system/stdout/system
});

it('flushes a partial line after 50 ms', async () => {
  const { pm, platform } = setup();
  await pm.start(req());
  platform.last().stdout.write('no newline');
  await vi.advanceTimersByTimeAsync(49);
  expect(pm.logs('p1', 'dev').lines.map((l) => l.text)).not.toContain('no newline');
  await vi.advanceTimersByTimeAsync(1);
  expect(pm.logs('p1', 'dev').lines.map((l) => l.text)).toContain('no newline');
});

it('auto-restarts with 1, 2, 4, 8 s backoff and gives up on the 5th crash (Review focus 2)', async () => {
  const { pm, platform, events } = setup();
  await pm.start(req({ autoRestart: true }));
  const delays = [1_000, 2_000, 4_000, 8_000];
  for (const delay of delays) {
    platform.last().exit(1);
    await flushIo();
    expect(pm.get('p1', 'dev')?.nextRestartAt).not.toBeNull();
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(platform.spawnScript).toHaveBeenCalledTimes(delays.indexOf(delay) + 1);
    await vi.advanceTimersByTimeAsync(1);
    await flushIo();
    expect(platform.spawnScript).toHaveBeenCalledTimes(delays.indexOf(delay) + 2);
  }
  platform.last().exit(1);
  await flushIo();
  expect(pm.get('p1', 'dev')?.gaveUp).toBe(true);
  expect(pm.get('p1', 'dev')?.crashCount).toBe(5);
  const crashes = events.filter((e) => e.type === 'crashed');
  expect(crashes.map((e) => e.type === 'crashed' && e.final)).toEqual([false, false, false, false, true]);
});

it('resets the crash count after 60 s of healthy running', async () => { /* crash once with autoRestart, restart, advance 60 s, crashCount 0 */ });

it('cancels a pending restart on stop and clears crashed to stopped', async () => { /* crash → stop → advance 30 s → no new spawn; state stopped */ });

it('turning auto-restart off cancels a pending restart', async () => {});

it('marks stopped after 5 s if the tree does not exit, keeping the ledger entry', async () => {
  const { pm, platform, ledger } = setup();
  platform.killTree.mockResolvedValue(undefined); // child never exits
  await pm.start(req());
  const stopping = pm.stop('p1', 'dev');
  await vi.advanceTimersByTimeAsync(5_000);
  expect((await stopping).state).toBe('stopped');
  expect(ledger.remove).not.toHaveBeenCalled();
  expect(pm.logs('p1', 'dev').lines.at(-1)?.text).toBe('■ did not exit within 5 s');
});

it('logs a killTree failure by pid and code, never env or lines', async () => { /* killTree rejects NestboxError INTERNAL; logger entry fields { pid, code } */ });

it('a spawn failure (ENOENT) becomes crashed with a "could not start" line', async () => {});

it('a spawnScript VALIDATION throw is rethrown and leaves the entry stopped', async () => {});

it('stop during the env lookup prevents the spawn', async () => {
  // resolveShellEnv returns a deferred; start(); stop(); resolve env → spawnScript never called; state stopped
});

it('ignores close events from a previous run after a restart', async () => {});

it('stopAll stops matching live processes in parallel and leaves others', async () => {
  // p1 dev + p1::packages/api dev + p2 dev; stopAll(id => belongsTo(id, 'p1')) → p2 still running
});

it('liveCount counts starting, running and stopping', async () => {});

it('logs(afterSeq) returns only newer lines and lastSeq survives clearLogs', async () => {
  // clearLogs → logs() = { lines: [], firstSeq: lastSeq + 1, lastSeq } ; new lines continue the seq
});

it('caps the buffer at bufferLines()', async () => { /* bufferLines 1000; write 1500 lines; size 1000 */ });

it('never passes env values to the logger', async () => { /* after a full run, JSON.stringify(logger.entries) lacks 'do-not-log' */ });
```

`process-manager.integration.test.ts` runs on every OS. It uses a test adapter that spawns `process.execPath` with `-e <code>`, picked by script name (`ok`: print and exit 0; `crash`: print to stderr and exit 2; `long`: `setInterval`). `killTree` is `process.kill(pid)`, `processStartTime` is `Date.now()` and `resolveShellEnv` is `process.env`. Real timers.
  - `ok` ends as `exited` with its line in the logs.
  - `crash` ends as `crashed` with `exit.code === 2` and its stderr line.
  - `long`, once stopped, is `stopped` within 5 s.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement** `process-manager.ts`. The shape is below. Follow it, and let the tests drive the details.

```ts
interface Entry {
  req: StartRequest;
  state: ProcessState;
  child: ChildProcess | null;
  pid: number | null;
  startedAt: number | null;
  exit: ProcessSummary['exit'];
  crashCount: number;
  gaveUp: boolean;
  nextRestartAt: number | null;
  buffer: RingBuffer<LogLine>;
  seq: number;
  /** Bumped on every spawn and on a stop that pre-empts a spawn; events tagged with an older run are ignored. */
  run: number;
  handledRun: number;
  stopRequested: boolean;
  closed: Promise<void> | null;
  lastLine: string | null;
  lastStderr: string | null;
  splitters: Record<'stdout' | 'stderr', LineSplitter>;
  timers: Partial<Record<'promote' | 'healthy' | 'restart' | 'flush', ReturnType<typeof setTimeout>>>;
}

const keyOf = (projectId: string, script: string): string => JSON.stringify([projectId, script]);
```

Key behaviours, in order:

1. **`start`**
   1. Find or create the entry. The buffer capacity comes from `deps.bufferLines()` at creation.
   2. If the entry is live, throw `CONFLICT` with "The script is already running".
   3. Cancel any pending restart, reset `crashCount`/`gaveUp`, store `req`, then `await this.spawn(entry)`.
2. **`spawn`**
   1. `run = ++entry.run`. Reset `stopRequested`, `exit`, `pid`, `lastLine` and `lastStderr`.
   2. Set `state = 'starting'` and `startedAt = now()`.
   3. Add the system line `▸ <pm> run <script>` and emit `changed`.
   4. `await resolveShellEnv()`. If `run !== entry.run`, return: a stop pre-empted the spawn.
   5. Call `spawnScript`.
      - If it throws, set `state = 'stopped'`, add the system line `■ could not start: <error.message if NestboxError else "unexpected error">`, emit `changed`, and rethrow.
      - Otherwise, attach `data` handlers (gated on `run`), plus `error` and `close` handlers that both call `onClose(entry, run, …)`. `onClose` is idempotent per run through `handledRun`.
   6. Await `spawn` or `error`. If the child has no `pid`, return.
   7. Set `entry.pid` and start the `promote` (3 s) and `healthy` (60 s) timers.
   8. `startTime = await processStartTime(pid).catch(() => null)`. If the run is still current and the process hasn't closed, call `ledger.add(...)`.
   9. Emit `changed`.
3. **`onData`**
   1. `splitters[stream].push(chunk)` and append each line.
   2. If the splitter still holds a partial line and there's no flush timer, start one for 50 ms that flushes both splitters.
4. **`append`**
   1. `line = { seq: ++entry.seq, ts: now(), stream, text }`, then push it to the buffer.
   2. Track `lastLine` and `lastStderr` (non-blank lines only).
   3. Emit a `line` event.
5. **`onClose`**
   1. If `run !== entry.run` or `handledRun === run`, return. Otherwise set `handledRun = run`.
   2. Flush both splitters and clear the `promote`, `healthy` and `flush` timers. If a pid was set, call `ledger.remove(pid)`. Clear `child` and `pid`.
   3. Classify the exit:
      - **Stop requested:** `stopped`, with the line `■ stopped`.
      - **Code 0:** `exited`, with `exit = { code: 0, signal: null, lastLine }` and the line `■ exited with code 0`.
      - **Anything else:** `crashed`, with `crashCount++` and `exit = { code, signal, lastLine: lastStderr ?? lastLine }`. The line is `■ exited with code N`, `■ killed by SIGNAL`, or `■ could not start` when an `error` arrived with no pid.
   4. On a crash, `willRestart = req.autoRestart && crashCount < MAX_CRASHES`.
      - If true, set `nextRestartAt` and add the line `↻ restarting in N s`. Start the `restart` timer, which calls `spawn(entry)` and logs a failure as `logger.error('auto-restart failed', { pid: null })`.
      - If false and auto-restart is on, set `gaveUp = true` and add the line `■ gave up after 5 crashes`.
      - Either way, emit `crashed` with `final: !willRestart`.
   5. Emit `changed`.
6. **`stop`**
   1. Unknown key: throw `NOT_FOUND` with "Unknown process".
   2. Cancel any pending restart (clearing `nextRestartAt`).
   3. Not live:
      - from `crashed` or `exited`, set `state = 'stopped'` and emit `changed`;
      - in every not-live case, return the summary.
   4. Already `stopping`: await `closed` raced against the timeout, then return the summary.
   5. `starting` with no child yet (env lookup pending): `entry.run++`, `state = 'stopped'`, add the line `■ stopped`, emit `changed`, return.
   6. Otherwise:
      1. Set `stopRequested = true` and `state = 'stopping'`, then emit `changed`.
      2. If there is a pid, `await killTree(pid)` and log a failure as `logger.warn('killTree failed', { pid, code })`. With no pid, call `child.kill()`.
      3. Race `closed` against 5 s. On a timeout, if the run is still current: set `handledRun = run`, add the line `■ did not exit within 5 s`, set `state = 'stopped'` and emit `changed`. Don't remove the ledger entry: the next start offers it as an orphan.
7. **`setAutoRestart`** updates `entry.req.autoRestart` if the entry exists. Turning it off cancels a pending restart and clears `nextRestartAt`.
8. **`stopAll`** runs `Promise.allSettled` over the entries matching the filter: live ones, and ones with a pending restart.
9. **`logs`**
   - With no entry: `{ lines: [], firstSeq: 1, lastSeq: 0 }`.
   - With `afterSeq` undefined: the whole buffer.
   - Otherwise: `buffer.after(afterSeq)`.
   - In all cases, `firstSeq = lines[0]?.seq ?? entry.seq + 1` and `lastSeq = entry.seq`.
10. **`clearLogs`** calls `buffer.clear()`, leaving `seq` untouched.

The manager never logs `req.cwd`, env or line text. Log fields are limited to `pid`, `code` and `script` (a script name is not secret; it's in the local `package.json`).

- [ ] **Step 4:** Run `pnpm vitest run src/main/processes`. Expected: PASS, with the integration test passing on Linux too.
- [ ] **Step 5: Commit** `feat(processes): ProcessManager with crash classification, auto-restart and ledger`

---

### Task 13: Core process channels and project removal

**Files:**
- Modify: `src/shared/ipc-names.ts`, `src/shared/channels.ts`, `src/shared/client.ts`, `src/main/ipc/core-handlers.ts`, `src/main/ipc/core-handlers.test.ts`, `src/main/index.ts`
- Create: `src/main/processes/throttle.ts`, `src/main/processes/throttle.test.ts`

**Interfaces:**
- Produces:
  - Invoke channels:
    - `processes:list` (no input) returns `ProcessSummary[]`;
    - `processes:stopAll` takes `{ projectId?: Id }` and returns `void`.
  - Event channels: `processes:changed` (no payload) and `app:navigate` (a `NavigateSchema` payload).
  - Client: `api.processes.list()` and `api.processes.stopAll(projectId?)`.
  - `CoreHandlerDeps.processes: Pick<ProcessManager, 'list' | 'stopAll' | 'forget'>`.
  - `throttle(fn, ms): { (): void; cancel(): void }`, a trailing throttle that fires at most once per `ms` and always fires after the last call.
- `projects:remove` now stops the project's processes, including its workspaces', forgets them, and then removes the project.

- [ ] **Step 1: Write the failing tests**
  - `processes:list` returns the manager's list.
  - `processes:stopAll` with no project stops everything. With `projectId: 'r1'`, it passes a filter that is true for `r1` and `r1::a` and false for `r10`.
  - `projects:remove` awaits `stopAll` with the matching filter, then calls `forget`, then `projects.remove`, in that order (record the calls).
  - `throttle`, with fake timers: 5 calls within 100 ms fire once at the leading edge and once at the trailing edge, and `cancel` drops the trailing call.
  - The `register.test.ts` whitelist includes the new invoke channels. A preload `bridge.test.ts` check accepts `processes:changed` and `app:navigate` in `on()`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** In `index.ts`:
  - construct `createPidLedger(join(userData, 'processes.json'), logger)`;
  - construct the `ProcessManager` with `bufferLines: () => store.getSettings().logBufferLines`;
  - add `const notifyProcesses = throttle(() => emit('processes:changed'), 100)`;
  - subscribe with `processes.on((e) => { if (e.type === 'changed') notifyProcesses(); })`.

  `emit` must skip a destroyed `webContents` (`mainWindow?.isDestroyed()`).
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ipc): processes:list, processes:stopAll and processes:changed; remove stops processes`

---

### Task 14: Shell UI for processes

**Files:**
- Create: `src/renderer/components/StateDot.tsx`, `src/renderer/app/StatusBar.test.tsx`, `src/renderer/app/ProjectHeader.test.tsx`
- Modify: `src/renderer/lib/queries.ts`, `src/renderer/app/Sidebar.tsx`, `src/renderer/app/Sidebar.test.tsx`, `src/renderer/app/StatusBar.tsx`, `src/renderer/app/ProjectHeader.tsx`, `src/renderer/app/App.tsx`, `src/renderer/test/fixtures.ts`

**Interfaces:**
- Produces:
  - `queryKeys.processes`.
  - `useProcesses()`.
  - `useStopAll()`.
  - `useProcessesChangedSubscription()`, which invalidates `processes` (call it from `App`).
  - `StateDot({ state: AggregateState, label?: string })`, a `size-2 rounded-full` span:
    - `bg-ok` for running;
    - `bg-warn` for starting;
    - `bg-err` for crashed;
    - `bg-idle` for idle;
    - an `aria-label` when a label is given (e.g. "api: crashed"), otherwise `aria-hidden`.
  - `makeProcess(over)` in `test/fixtures.ts`.

- [ ] **Step 1: Write the failing tests**
  - **Sidebar:**
    - a project with a running process shows a dot labelled `shop: running`;
    - a collapsed root whose workspace has a crashed process shows `crashed`;
    - an expanded root shows only its own state, and the workspace row shows `crashed`;
    - `processes:changed` refetches.
  - **StatusBar:** `2 running` counts starting plus running across projects, and the count is hidden when 0. Leave the read-only warning to Task 24.
  - **ProjectHeader:**
    - "Stop all" is absent with no live process;
    - it is present when a workspace of the root has one;
    - clicking it calls `processes:stopAll` with `{ projectId: 'p1' }` and shows no confirm.
  - **Remove dialog:** with 2 live processes, the description says `2 running scripts will be stopped.`
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Sidebar row state: `aggregateState(processes.filter((p) => collapsedRoot ? belongsTo(p.projectId, id) : p.projectId === id).map((p) => p.state))`. Replace the M0 comment and the grey dot in `ProjectRow` with `StateDot`. "Stop all" goes before the overflow menu (lucide `Square`, `variant="secondary"`, `text-err` icon).
- [ ] **Step 4:** Run `pnpm vitest run --project renderer`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): process state dots, running count and Stop all`

---

### Task 15: Tool infrastructure — settings, factories, events, dispose timeout

**Files:**
- Modify: `src/shared/tool.ts`, `src/shared/tools/index.ts`, `src/main/tools/types.ts`, `src/main/tools/tool-host.ts`, `src/main/tools/tool-host.test.ts`, `src/main/tools/index.ts`, `src/main/projects/project-service.ts`, `src/main/projects/project-service.test.ts`, `src/main/index.ts`
- Create: `src/renderer/lib/tool-events.ts`, `src/renderer/lib/tool-events.test.tsx`

**Interfaces:**
- Produces:

```ts
// shared/tool.ts
export type ToolEvents = Record<string, z.ZodType>;
export function defineEvents<E extends ToolEvents>(events: E): E { return events; }
export const ToolEventEnvelopeSchema = z.object({ toolId: z.string(), projectId: z.string(), event: z.string(), payload: z.unknown() });

// shared/tools/index.ts
export const toolEvents = { 'project-info': {}, /* scripts added in Task 16 */ } as const satisfies Record<ToolId, ToolEvents>;
export type ToolEventName<T extends ToolId> = keyof (typeof toolEvents)[T] & string;
export type ToolEventPayload<T extends ToolId, E extends ToolEventName<T>> = z.output<(typeof toolEvents)[T][E] & z.ZodType>;

// main/tools/types.ts
export interface ToolSettingsAccess<S> {
  /** Parsed with the tool's settingsSchema; invalid stored data falls back to schema defaults (logged by tool id). */
  get(): S;
  /** Validates, persists on the root project, returns the stored value. Throws INTERNAL on a read-only store. */
  update(fn: (current: S) => S): S;
}
export interface ToolContext<S = unknown> { project; shared; emit; platform; settings: ToolSettingsAccess<S> }
// ToolHandlers<C, S> and MainTool<S, C> thread S through to ctx.

// ToolHostDeps
toolSettings: { get(rootId: string, toolId: string): unknown; set(rootId: string, toolId: string, value: unknown): void };
// ToolHost
disposeAll(timeoutMs?: number): Promise<{ failed: string[]; timedOut: string[] }>;

// ProjectService
getRunGroups(rootId: string): RunGroup[];
setRunGroups(rootId: string, groups: RunGroup[]): RunGroup[];   // validates, persists, onChanged()
getToolSettings(rootId: string, toolId: string): unknown;
setToolSettings(rootId: string, toolId: string, value: unknown): void;

// main/tools/index.ts
export interface MainToolDeps { scripts: ScriptsToolDeps }  // Task 16
export function createMainTools(deps: MainToolDeps): readonly AnyMainTool[];

// renderer/lib/tool-events.ts
export function useToolEvent<T extends ToolId, E extends ToolEventName<T>>(
  toolId: T, projectId: string, event: E, onEvent: (payload: ToolEventPayload<T, E>) => void,
): void;
```

- [ ] **Step 1: Write the failing tests**
  - **Tool host:**
    - `ctx.settings.get()` returns schema defaults when nothing is stored;
    - it returns stored values when valid, and defaults plus one `warn` (`{ toolId }`) when invalid;
    - `update` validates, calls `toolSettings.set(rootId, toolId, value)`, and rejects invalid values without calling `set`;
    - a workspace project's context reads and writes the **root's** settings.
  - **`disposeAll(50)`:**
    - one tool's dispose rejects and another never resolves;
    - it resolves within about 50 ms with `{ failed: ['a'], timedOut: ['b'] }`;
    - it logs `tool dispose failed` and `tool dispose timed out` with `{ toolId }`.
  - **Project service:**
    - `setRunGroups` on a root persists the groups and calls `onChanged`;
    - on a workspace id it throws `VALIDATION`;
    - invalid groups throw and leave the store unchanged;
    - `setToolSettings` and `getToolSettings` round-trip through `toolSettings[toolId]`.
  - **`useToolEvent`:**
    - fires for a matching tool, project and event with a valid payload;
    - ignores other projects;
    - drops an invalid payload silently;
    - unsubscribes on unmount.

    Use the mock bridge's `emit('tools:event', …)`. Register a test-only event schema through a `vi.mock` of `@shared/tools` that extends `toolEvents`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** In `index.ts`, replace `mainTools` with `createMainTools(...)`. The scripts deps arrive in Task 16, so until then `createMainTools` returns `[projectInfoTool]` and takes `{}`. Make the `defineMainTool` generic over `S` so the project-info tool still type-checks. Update the CLAUDE.md "Adding a tool" text in Task 28, not here.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tools): tool settings access, event schemas, factories and dispose timeout`

---

### Task 16: Scripts tool — contract and main half

**Files:**
- Create: `src/shared/tools/scripts/contract.ts`, `src/shared/tools/scripts/contract.test.ts`, `src/main/tools/scripts/index.ts`, `src/main/tools/scripts/index.test.ts`, `src/main/tools/scripts/log-batcher.ts`, `src/main/tools/scripts/log-batcher.test.ts`, `src/main/tools/scripts/export.ts`, `src/main/tools/scripts/export.test.ts`
- Modify: `src/shared/tools/index.ts`, `src/main/tools/index.ts`, `src/main/index.ts`

**Interfaces:**
- Produces:

```ts
// shared/tools/scripts/contract.ts
const ScriptName = z.string().min(1).max(200);
const ScriptInput = z.strictObject({ script: ScriptName });

const settingsSchema = z.object({ autoRestart: z.array(RunGroupEntrySchema).max(500).default([]) });
export type ScriptsSettings = z.infer<typeof settingsSchema>;

export const scriptsDefinition: ToolDefinition<ScriptsSettings> = {
  id: 'scripts',
  name: 'Scripts',
  icon: 'terminal',
  appliesTo: (p) => Object.keys(p.packageJson?.scripts ?? {}).length > 0 || p.workspaces.length > 0,
  settingsSchema,
};

export const ScriptInfoSchema = z.object({ name: z.string(), command: z.string(), autoRestart: z.boolean() });
export const PackageScriptsSchema = z.object({ relPath: z.string(), name: z.string(), scripts: z.array(z.string()) });
export const SkippedEntrySchema = RunGroupEntrySchema.extend({ reason: z.enum(['missing', 'running']) });

export const scriptsContract = defineContract({
  list: {
    input: z.strictObject({}),
    output: z.object({
      scripts: z.array(ScriptInfoSchema),
      /** Root projects only; null for workspace packages. */
      runGroups: z.array(RunGroupSchema).nullable(),
      packages: z.array(PackageScriptsSchema).nullable(),
    }),
  },
  start: { input: ScriptInput, output: ProcessSummarySchema },
  stop: { input: ScriptInput, output: ProcessSummarySchema },
  restart: { input: ScriptInput, output: ProcessSummarySchema },
  setAutoRestart: { input: z.strictObject({ script: ScriptName, enabled: z.boolean() }), output: z.object({ enabled: z.boolean() }) },
  getLogs: { input: z.strictObject({ script: ScriptName, afterSeq: z.number().int().nonnegative().optional() }), output: LogSnapshotSchema },
  clearLogs: { input: ScriptInput, output: z.void() },
  exportLogs: {
    input: z.strictObject({ script: ScriptName, seqs: z.union([z.literal('all'), z.array(z.number().int().positive()).max(100_000)]) }),
    output: z.object({ saved: z.boolean() }),
  },
  openFileAt: { input: z.strictObject({ path: z.string().min(1).max(4096), line: z.number().int().positive() }), output: z.void() },
  saveRunGroup: { input: z.strictObject({ previousName: z.string().optional(), group: RunGroupSchema }), output: z.array(RunGroupSchema) },
  deleteRunGroup: { input: z.strictObject({ name: z.string().min(1) }), output: z.array(RunGroupSchema) },
  startRunGroup: {
    input: z.strictObject({ name: z.string().min(1) }),
    output: z.object({ started: z.array(ProcessSummarySchema), skipped: z.array(SkippedEntrySchema) }),
  },
  stopRunGroup: { input: z.strictObject({ name: z.string().min(1) }), output: z.void() },
});

export const scriptsEvents = defineEvents({
  logs: z.object({ script: z.string(), lines: z.array(LogLineSchema) }),
});
```

```ts
// main/tools/scripts/index.ts
export interface ScriptsToolDeps {
  processes: ProcessManager;
  projects: Pick<ProjectService, 'getRunGroups' | 'setRunGroups' | 'getDetected'>;
  shared: SharedContext;
  saveFile(defaultName: string): Promise<string | null>;
  writeFile(path: string, text: string): Promise<void>;
  isFile(path: string): Promise<boolean>;
  emit(projectId: string, event: 'logs', payload: { script: string; lines: LogLine[] }): void;
  logger: Logger;
}
export function createScriptsTool(deps: ScriptsToolDeps): AnyMainTool;

// log-batcher.ts
export function createLogBatcher(opts: {
  intervalMs: number;
  flush(projectId: string, script: string, lines: LogLine[]): void;
}): { add(projectId: string, script: string, line: LogLine): void; flushNow(): void; dispose(): void };

// export.ts
export function formatExport(lines: readonly LogLine[]): string; // `${new Date(ts).toISOString()} ${stripAnsi(text)}` joined with \r\n, trailing newline
export function exportFileName(script: string, now: Date): string; // e.g. dev_api-20261001-120304.log; unsafe chars → _
```

- [ ] **Step 1: Write the failing tests**

  **`log-batcher.test.ts`** (fake timers):
  - lines for two keys within 50 ms flush once per key, in order, at 50 ms;
  - nothing flushes when idle;
  - `flushNow` flushes immediately;
  - `dispose` cancels the timer.

  **`export.test.ts`**:
  - ANSI is stripped;
  - lines are CRLF-joined;
  - the timestamp is ISO;
  - `exportFileName('dev:api', new Date('2026-10-01T12:03:04Z'))` gives `dev_api-20261001-120304.log`, in local time (assert with a TZ-independent pattern).

  **`contract.test.ts`**:
  - `appliesTo` is true with scripts or workspaces and false otherwise;
  - the settings default is `{ autoRestart: [] }`;
  - `exportLogs` rejects 100 001 seqs.

  **`index.test.ts`**: drive the tool through `createToolHost` with a real `ProcessManager` over `fakePlatform()` (Task 12), a fake project service holding a root `r1` with scripts `{ dev, build }` and workspace `r1::packages/api` with `{ dev }`, and an in-memory tool settings map.
  - **`list`**:
    - on the root, gives scripts with `autoRestart`, the run groups, and packages for the root plus `packages/api`;
    - on a workspace, `runGroups` and `packages` are `null`.
  - **`start`/`stop`/`restart`**:
    - `start` spawns with `cwd` set to the project path and the root's package manager;
    - an unknown script is `NOT_FOUND` with the message `Unknown script` (no name);
    - `autoRestart` comes from settings.
  - **`setAutoRestart`**: persists `{ relPath: 'packages/api', script: 'dev' }` in the **root's** settings, and updates a live entry.
  - **`getLogs`** with `afterSeq` returns only newer lines.
  - **`exportLogs`**:
    - `saveFile` returning `null` gives `{ saved: false }`, and `writeFile` isn't called;
    - `seqs: [2, 3]` writes those two lines only;
    - `'all'` writes the buffer.
  - **`openFileAt`**:
    - a relative `src/a.ts` resolves against the project path;
    - `/src/a.ts` (Vite style) resolves against the project path, not the drive root;
    - `file:///C:/x/a.ts` gives `C:\x\a.ts` (use `fileURLToPath`; on non-Windows CI, assert with `path.resolve` semantics);
    - a missing file is `NOT_FOUND` "File not found";
    - an existing file calls `platform.openInEditor(abs, line)`.
  - **Run groups**:
    - `saveRunGroup` on a workspace is `VALIDATION`;
    - a duplicate name is `CONFLICT`;
    - `previousName` renames;
    - `deleteRunGroup` removes.
  - **`startRunGroup`** with entries `[{ '', dev }, { 'packages/api', dev }, { 'packages/gone', dev }, { '', nope }]`:
    - starts two (the API one with the workspace cwd);
    - reports two skipped as `missing`, and an already-running one as `running` (Review focus 7).
  - **`stopRunGroup`** stops only the group's live entries.
  - **Log events**: lines written by a fake child arrive through `deps.emit('r1::packages/api', 'logs', { script: 'dev', lines })` after 50 ms, batched.
  - **Shared context**: after a start, `shared.forProject('r1').get('scripts.processes')` is `[{ script: 'dev', pid: 1000, state: 'starting' }]`.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**

```ts
export function createScriptsTool(deps: ScriptsToolDeps): AnyMainTool {
  const batcher = createLogBatcher({
    intervalMs: 50,
    flush: (projectId, script, lines) => deps.emit(projectId, 'logs', { script, lines }),
  });
  deps.processes.on((event) => {
    if (event.type === 'line') batcher.add(event.projectId, event.script, event.line);
    if (event.type === 'changed') publishFacts();
  });

  function publishFacts(): void {
    const byProject = new Map<string, { script: string; pid: number | null; state: ProcessState }[]>();
    for (const p of deps.processes.list()) {
      const list = byProject.get(p.projectId) ?? [];
      list.push({ script: p.script, pid: p.pid, state: p.state });
      byProject.set(p.projectId, list);
    }
    for (const [projectId, facts] of byProject) deps.shared.forProject(projectId).publish('scripts.processes', facts);
  }

  const requireScript = (project: DetectedProject, script: string): void => {
    if (!Object.hasOwn(project.packageJson?.scripts ?? {}, script)) throw new NestboxError('NOT_FOUND', 'Unknown script');
  };
  const isAuto = (s: ScriptsSettings, project: DetectedProject, script: string) =>
    s.autoRestart.some((e) => e.relPath === project.relPath && e.script === script);
  const requestFor = (project: DetectedProject, script: string, autoRestart: boolean): StartRequest => ({
    projectId: project.id, script, cwd: project.path, packageManager: project.packageManager, autoRestart,
  });
  const requireRoot = (project: DetectedProject): void => {
    if (project.relPath !== '') throw new NestboxError('VALIDATION', 'Run groups belong to the root project');
  };

  return defineMainTool({
    ...scriptsDefinition,
    contract: scriptsContract,
    async dispose() {
      batcher.flushNow();
      batcher.dispose();
    },
    handlers: {
      list: async (ctx) => { /* scripts from ctx.project.packageJson; runGroups/packages only when relPath === '' */ },
      start: async (ctx, { script }) => {
        requireScript(ctx.project, script);
        return deps.processes.start(requestFor(ctx.project, script, isAuto(ctx.settings.get(), ctx.project, script)));
      },
      // stop, restart, setAutoRestart, getLogs, clearLogs, exportLogs, openFileAt,
      // saveRunGroup, deleteRunGroup, startRunGroup, stopRunGroup: as tested above
    },
  });
}
```

  To resolve a run-group entry: `projectId = entry.relPath === '' ? rootId : workspaceId(rootId, entry.relPath)`, then `deps.projects.getDetected(projectId)`. A `NOT_FOUND` there, or a missing script, counts as `missing`. Settings for an entry in another package come from the root, which is the same slice. `startRunGroup` starts the entries in parallel with `Promise.allSettled`. A `CONFLICT` counts as `running`, and any other failure is rethrown after the others settle.

  In `openFileAt`, path rules in order:
  1. A `file:` URL goes through `fileURLToPath`.
  2. `/^[\\/](?![\\/])/` (rooted but not UNC) resolves as `resolve(project.path, '.' + p)`.
  3. Any other absolute path is kept.
  4. Anything else resolves as `resolve(project.path, p)`.

  Then `isFile` must be true. Don't log the path.

  In `index.ts`, wire the deps:
  - `saveFile` uses `dialog.showSaveDialog(mainWindow, { defaultPath: join(app.getPath('downloads'), name), filters: [{ name: 'Log', extensions: ['log', 'txt'] }] })`;
  - `writeFile` uses `fs.promises.writeFile`;
  - `isFile` uses `stat(...).isFile()` and catches to `false`;
  - `emit` uses `emit('tools:event', { toolId: 'scripts', projectId, event, payload })`.

  Register `scripts` in `toolContracts`, `toolDefinitions` and `toolEvents`.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scripts): scripts tool main half with run groups, export and log streaming`

---
### Task 17: Renderer log parsers — ANSI, structured lines, links, pieces

All of these are pure functions with no React, unit-tested in the `renderer` project.

**Files:**
- Create: `src/renderer/tools/scripts/ansi.ts`, `ansi.test.ts`, `structured.ts`, `structured.test.ts`, `links.ts`, `links.test.ts`, `pieces.ts`, `pieces.test.ts`, `filters.ts`, `filters.test.ts` (all under `src/renderer/tools/scripts/`)
- Modify: `src/renderer/styles/globals.css`

**Interfaces:**

```ts
// ansi.ts
export type AnsiColor = { kind: 'palette'; index: number } | { kind: 'rgb'; r: number; g: number; b: number };
export interface AnsiStyle {
  fg: AnsiColor | null; bg: AnsiColor | null;
  bold: boolean; dim: boolean; italic: boolean; underline: boolean; inverse: boolean;
}
export interface AnsiSegment { text: string; style: AnsiStyle }
export function parseAnsi(input: string): AnsiSegment[];
/** Tailwind/utility classes plus an inline style for rgb colours. Never hex. */
export function ansiProps(style: AnsiStyle): { className: string; style?: { color?: string; backgroundColor?: string } };

// structured.ts
export const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type Level = (typeof LEVELS)[number];
export interface StructuredLine {
  level: Level; time: number | null; context: string | null; message: string; requestId: string | null;
  raw: Record<string, unknown>;
}
export function parseStructured(text: string): StructuredLine | null;
/** Cached per LogLine object; system lines are never structured. */
export function structuredOf(line: LogLine): StructuredLine | null;

// links.ts
export interface LinkMatch { start: number; end: number; path: string; line: number }
export function findLinks(text: string): LinkMatch[];

// pieces.ts
export interface Piece { text: string; style: AnsiStyle; link: LinkMatch | null; match: boolean }
export function findMatches(text: string, query: string): { start: number; end: number }[]; // case-insensitive, non-overlapping
export function decorate(segments: AnsiSegment[], links: LinkMatch[], matches: { start: number; end: number }[]): Piece[];

// filters.ts
export interface LogFilters { levels: ReadonlySet<Level>; context: string | null; requestId: string }
export const NO_FILTERS: LogFilters;
export function structuredFilterActive(f: LogFilters): boolean;
/** With a structured filter active, plain and system lines are hidden (design: "While any of these is set, plain lines are hidden"). */
export function visibleLines(lines: readonly LogLine[], f: LogFilters): LogLine[];
/** Indexes into `visible` whose searchable text contains the query. */
export function searchHits(visible: readonly LogLine[], query: string): number[];
export function searchableText(line: LogLine): string; // stripAnsi(text), or message + JSON.stringify(raw) for structured
export function contextsOf(lines: readonly LogLine[]): string[]; // sorted, unique
```

- [ ] **Step 1: Write the failing tests**

  **ANSI**:
  - `'\x1b[31mred\x1b[0m plain'` gives two segments, `red` with `fg: palette 1` and ` plain` with a plain style;
  - bright `\x1b[92m` gives palette 10, and background `\x1b[44m` gives bg palette 4;
  - 256-colour `\x1b[38;5;208m` gives rgb(255, 135, 0), `\x1b[38;5;3m` gives palette 3, and `\x1b[38;5;240m` gives rgb(88, 88, 88);
  - truecolor `\x1b[38;2;10;20;30m` gives rgb(10, 20, 30), including the `:` separator form;
  - bold, dim, italic, underline and inverse switch on and off with 1/22, 2/22, 3/23, 4/24 and 7/27;
  - `\x1b[m` resets;
  - cursor, erase and OSC sequences are dropped (`'\x1b[2K\x1b]0;title\x07ok'` gives `ok`);
  - a malformed `\x1b[38;5m` doesn't throw;
  - adjacent text with the same style merges into one segment;
  - `ansiProps` gives `ansi-fg-1` for palette 1, `color: 'rgb(10 20 30)'` for rgb, `font-semibold` for bold, `opacity-60` for dim, `italic`, `underline`;
  - inverse with no colours gives `ansi-inverse`, and inverse with fg palette 2 gives `ansi-bg-2 ansi-fg-inverse`.

  **Structured** (fixtures as string literals in the test):
  - **pino:** `{"level":30,"time":1727780000000,"pid":1,"hostname":"h","reqId":"req-1","context":"Http","msg":"GET /"}` gives `info`, time, `Http`, `GET /`, `req-1`;
  - the pino level ladder 10, 20, 40, 50 and 60 maps to trace, debug, warn, error and fatal;
  - `req.id` is used when `reqId` is absent;
  - **NestJS JSON logger:** `{"level":"log","pid":1,"timestamp":1727780000000,"message":"Nest application successfully started","context":"NestApplication"}` gives `info`;
  - NestJS `"verbose"` gives `trace`, an object `message` is JSON-stringified, and an ISO-string `timestamp` is parsed;
  - a winston-style `{"level":"warn","message":"x"}` gives `warn`;
  - it returns `null` for:
    - plain text;
    - `{` with invalid JSON;
    - a JSON array;
    - JSON with no recognisable level (`{"a":1}`);
    - `{"level":"loud"}`;
  - ANSI around the JSON is ignored;
  - `structuredOf` returns the same object for the same line, and `null` for `stream: 'system'`.

  **Links** (each asserts the path, the line, and that `text.slice(start, end)` is the visible link):
  - `'    at main (C:\\Users\\me\\My App\\src\\index.ts:12:5)'` gives `C:\Users\me\My App\src\index.ts` and 12, excluding the parentheses;
  - `'    at C:\\dev\\app\\dist\\main.js:3:9'` gives `C:\dev\app\dist\main.js` and 3;
  - `'src/app.ts(12,5): error TS2322: ...'` gives `src/app.ts` and 12;
  - `'[vite] /src/App.tsx:3:1 failed'` gives `/src/App.tsx` and 3;
  - `'see ./lib/x.mjs:7'` gives `./lib/x.mjs` and 7;
  - `'file:///C:/dev/app/index.js:1:1'` gives `file:///C:/dev/app/index.js` and 1;
  - none of these match: `http://localhost:3000`, `12:03:04`, `v1.2.3:4`, `ratio 3:2`, `node:internal/modules/cjs/loader:1228`;
  - two links on one line come back in order, without overlaps.

  **Pieces**:
  - `decorate` splits segments at link and match boundaries, and keeps the styles;
  - a link spanning two ANSI segments yields two pieces with the same link;
  - `findMatches('Error error', 'error')` gives two ranges;
  - an empty query gives `[]`.

  **Filters**:
  - with no filters, everything is visible;
  - a levels filter of `{error}` keeps only structured error lines and hides plain and system lines;
  - the context filter and the `requestId` substring filter work, and combine with AND;
  - `searchHits` finds the query in plain text, with ANSI stripped, and in structured message and raw JSON;
  - `contextsOf` is sorted and unique.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement**

```ts
// ansi.ts
const PLAIN: AnsiStyle = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };
// eslint-disable-next-line no-control-regex -- terminal escape sequences
const SEQUENCE = /\u001b\[([0-9;:]*)m|\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

export function parseAnsi(input: string): AnsiSegment[] {
  const out: AnsiSegment[] = [];
  let style = PLAIN;
  let last = 0;
  const push = (text: string): void => {
    if (!text) return;
    const prev = out.at(-1);
    if (prev && prev.style === style) prev.text += text;
    else out.push({ text, style });
  };
  for (const m of input.matchAll(SEQUENCE)) {
    push(input.slice(last, m.index));
    if (m[1] !== undefined) style = applySgr(style, m[1]);
    last = m.index + m[0].length;
  }
  push(input.slice(last));
  return out;
}

const palette = (index: number): AnsiColor => ({ kind: 'palette', index });
const cube = (v: number): number => (v === 0 ? 0 : 55 + v * 40);

function color256(n: number | undefined): AnsiColor | null {
  if (n === undefined || !Number.isInteger(n) || n < 0 || n > 255) return null;
  if (n < 16) return palette(n);
  if (n < 232) {
    const i = n - 16;
    return { kind: 'rgb', r: cube(Math.floor(i / 36)), g: cube(Math.floor(i / 6) % 6), b: cube(i % 6) };
  }
  const v = 8 + (n - 232) * 10;
  return { kind: 'rgb', r: v, g: v, b: v };
}

function applySgr(current: AnsiStyle, params: string): AnsiStyle {
  const codes = params === '' ? [0] : params.split(/[;:]/).map((p) => (p === '' ? 0 : Number(p)));
  let s: AnsiStyle = { ...current };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i] ?? 0;
    if (c === 0) s = { ...PLAIN };
    else if (c === 1) s.bold = true;
    else if (c === 2) s.dim = true;
    else if (c === 3) s.italic = true;
    else if (c === 4) s.underline = true;
    else if (c === 7) s.inverse = true;
    else if (c === 22) { s.bold = false; s.dim = false; }
    else if (c === 23) s.italic = false;
    else if (c === 24) s.underline = false;
    else if (c === 27) s.inverse = false;
    else if (c >= 30 && c <= 37) s.fg = palette(c - 30);
    else if (c === 39) s.fg = null;
    else if (c >= 40 && c <= 47) s.bg = palette(c - 40);
    else if (c === 49) s.bg = null;
    else if (c >= 90 && c <= 97) s.fg = palette(c - 90 + 8);
    else if (c >= 100 && c <= 107) s.bg = palette(c - 100 + 8);
    else if (c === 38 || c === 48) {
      const mode = codes[i + 1];
      let color: AnsiColor | null = null;
      if (mode === 5) { color = color256(codes[i + 2]); i += 2; }
      else if (mode === 2) {
        const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
        if ([r, g, b].every((v) => v !== undefined && v >= 0 && v <= 255)) color = { kind: 'rgb', r: r!, g: g!, b: b! };
        i += 4;
      } else break;
      if (c === 38) s.fg = color;
      else s.bg = color;
    }
  }
  return s;
}
```

`structured.ts`:

```ts
const PINO: [number, Level][] = [[10, 'trace'], [20, 'debug'], [30, 'info'], [40, 'warn'], [50, 'error']];
const NAMED: Record<string, Level> = {
  trace: 'trace', verbose: 'trace', debug: 'debug', info: 'info', log: 'info',
  warn: 'warn', warning: 'warn', error: 'error', fatal: 'fatal',
};

export function parseStructured(text: string): StructuredLine | null {
  const t = stripAnsi(text).trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(t);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const level = levelOf(raw['level']);
  if (!level) return null;
  const msg = raw['msg'] ?? raw['message'];
  return {
    level,
    time: timeOf(raw['time'] ?? raw['timestamp']),
    context: typeof raw['context'] === 'string' ? raw['context'] : null,
    message: typeof msg === 'string' ? msg : msg === undefined ? '' : JSON.stringify(msg),
    requestId: idOf(raw['reqId'] ?? raw['requestId'] ?? (isRecord(raw['req']) ? raw['req']['id'] : undefined)),
    raw,
  };
}

function levelOf(v: unknown): Level | null {
  if (typeof v === 'number' && Number.isFinite(v)) return PINO.find(([max]) => v <= max)?.[1] ?? 'fatal';
  if (typeof v === 'string') return NAMED[v.toLowerCase()] ?? null;
  return null;
}
const timeOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : null;
const idOf = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

const cache = new WeakMap<LogLine, StructuredLine | null>();
export function structuredOf(line: LogLine): StructuredLine | null {
  if (line.stream === 'system') return null;
  if (!cache.has(line)) cache.set(line, parseStructured(line.text));
  return cache.get(line) ?? null;
}
```

  `isRecord` comes from `@shared/is-record`.

`links.ts`:

```ts
const EXT = 'ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|astro|json|css|scss|less|html|md|mdx|prisma|graphql|ya?ml';
const REL = `(?:\\.{1,2}[\\\\/]|[\\\\/])?(?:[\\w@.-]+[\\\\/])*[\\w@.-]+\\.(?:${EXT})`;

/** Each pattern captures (path)(line); a match's visible range is the whole match. */
const PATTERNS: RegExp[] = [
  /(file:\/\/\/[^\s'"()<>]+?):(\d+)(?::\d+)?(?!\d)/g,
  /(?<=\()([A-Za-z]:[\\/][^()\r\n]+?):(\d+)(?::\d+)?(?=\))/g,
  /([A-Za-z]:[\\/][^\s'"()<>|:]+):(\d+)(?::\d+)?(?!\d)/g,
  new RegExp(`(?<![\\w@./\\\\-])(${REL})\\((\\d+),\\d+\\)`, 'g'),
  new RegExp(`(?<![\\w@.:/\\\\-])(${REL}):(\\d+)(?::\\d+)?(?!\\d)`, 'g'),
];

export function findLinks(text: string): LinkMatch[] {
  const found: LinkMatch[] = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const line = Number(m[2]);
      if (!m[1] || !Number.isInteger(line) || line < 1) continue;
      found.push({ start: m.index, end: m.index + m[0].length, path: m[1], line });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: LinkMatch[] = [];
  for (const l of found) if (!out.length || l.start >= (out.at(-1)?.end ?? 0)) out.push(l);
  return out;
}
```

  If a link test fails, adjust the patterns. Don't drop the test case, because each one comes from real Node, tsc or Vite output.

  `pieces.ts`: collect the boundaries (segment edges, link and match starts and ends), sort them uniquely, and walk the segments. For each sub-range, record the style of the segment it is in, the link covering it (if any), and whether a match covers it.

  `globals.css`: add `--ansi-0` … `--ansi-15` with the terminal palette below (hex is allowed here). Also add `.ansi-fg-N { color: var(--ansi-N) }` and `.ansi-bg-N { background-color: var(--ansi-N) }` for N = 0–15, plus `.ansi-inverse { color: var(--nb-bg); background-color: var(--nb-text) }` and `.ansi-fg-inverse { color: var(--nb-bg) }`. This is a terminal palette, not UI accent colours, so it doesn't break the one-accent rule. The palette:

| # | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal | `#484f58` | `#ff7b72` | `#3fb950` | `#d29922` | `#58a6ff` | `#d2a8ff` | `#39c5cf` | `#b1bac4` |
| bright | `#6e7681` | `#ffa198` | `#56d364` | `#e3b341` | `#79c0ff` | `#e2c5ff` | `#56d4dd` | `#f0f6fc` |

- [ ] **Step 4:** Run `pnpm vitest run --project renderer src/renderer/tools/scripts && pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scripts): ANSI, structured-line and file-link parsers for the log viewer`

---

### Task 18: Log line store and stream hook

**Files:**
- Create: `src/renderer/tools/scripts/line-store.ts`, `line-store.test.ts`, `use-log-stream.ts`, `use-log-stream.test.tsx`, `use-scripts.ts`
- Modify: `src/renderer/lib/tool-events.ts` (export a non-hook `subscribeToolEvent`, used by `useToolEvent` too)

**Interfaces:**

```ts
// line-store.ts
export type ApplyStatus = 'ok' | 'gap';
export class LogLineStore {
  constructor(cap: number);
  readonly subscribe: (cb: () => void) => () => void;
  readonly getSnapshot: () => readonly LogLine[];
  get lastSeq(): number;
  setCap(cap: number): void;
  /** 'replace' for the first load; 'delta' for a resync fetched with afterSeq = lastSeq. Drains queued batches. */
  applySnapshot(snap: LogSnapshot, mode: 'replace' | 'delta'): ApplyStatus;
  /** Queues while a snapshot is outstanding; 'gap' means the caller must fetch a delta. */
  append(batch: readonly LogLine[]): ApplyStatus;
  clear(): void;
}

// use-log-stream.ts
export function useLogStream(projectId: string, script: string | null): {
  lines: readonly LogLine[];
  status: 'loading' | 'ready' | 'error';
  clear(): Promise<void>;
};

// use-scripts.ts
export function useScriptList(projectId: string);                // query ['tool','scripts',projectId,'list']
export function useScriptAction(projectId: string);              // mutation: { action: 'start'|'stop'|'restart', script }
export function useSetAutoRestart(projectId: string);
export function useRunGroupActions(projectId: string);           // save, delete, start, stop
export function useExportLogs(projectId: string);
export function useOpenFileAt(projectId: string);
```

`processes:changed` already invalidates `processes`. The `list` query is invalidated by the run-group and auto-restart mutations and by `projects:changed` (Task 25).

- [ ] **Step 1: Write the failing tests** (`line-store.test.ts`, Review focus 6)

```ts
const l = (seq: number, text = `l${seq}`): LogLine => ({ seq, ts: seq, stream: 'stdout', text });
const snap = (lines: LogLine[], lastSeq = lines.at(-1)?.seq ?? 0): LogSnapshot => ({ lines, firstSeq: lines[0]?.seq ?? lastSeq + 1, lastSeq });

it('queues batches that arrive before the snapshot and drops the overlap', () => {
  const s = new LogLineStore(100);
  expect(s.append([l(3), l(4)])).toBe('ok');
  s.applySnapshot(snap([l(1), l(2), l(3)]), 'replace');
  expect(s.getSnapshot().map((x) => x.seq)).toEqual([1, 2, 3, 4]);
});

it('reports a gap and recovers through a delta without duplicates', () => {
  const s = new LogLineStore(100);
  s.applySnapshot(snap([l(1)]), 'replace');
  expect(s.append([l(4)])).toBe('gap');
  expect(s.append([l(5)])).toBe('ok'); // queued while resyncing
  s.applySnapshot(snap([l(2), l(3), l(4)], 4), 'delta');
  expect(s.getSnapshot().map((x) => x.seq)).toEqual([1, 2, 3, 4, 5]);
});

it('ignores a replayed batch', () => { /* append [l(1)] after snapshot [l(1)] → unchanged, 'ok' */ });
it('caps to the newest lines', () => { /* cap 3, five lines → seqs 3,4,5 */ });
it('clear keeps lastSeq so later lines continue', () => { /* clear → []; append [l(lastSeq+1)] → ok */ });
it('accepts a delta whose firstSeq skips ahead (ring buffer dropped lines)', () => { /* lastSeq 1, delta [l(10)] lastSeq 10 → [1,10] */ });
it('notifies subscribers once per change and returns a new array reference', () => {});
```

  `use-log-stream.test.tsx`, with the mock bridge:
  - on mount it calls `getLogs({ script: 'dev' })` and renders the lines;
  - a `tools:event` batch appends;
  - a gap triggers `getLogs({ script: 'dev', afterSeq: n })`;
  - two consumers of the same script share one `getLogs` call;
  - unmounting both and remounting fetches again;
  - another project's events are ignored;
  - `clear()` calls `clearLogs` and empties.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - **`LogLineStore`.** A `pending: LogLine[]` queue is used while `!ready`. `ready` is false initially and between a `'gap'` and the following `'delta'`. `applySnapshot` merges the lines (filtered by seq for a delta), sets `lastSeq = max(lastSeq, snap.lastSeq)`, then drains `pending` through the same contiguity check it uses for `append`. If that check finds a gap, it returns `'gap'` and stays not-ready.
  - **`useLogStream`.** A module-level `Map<string, { store; refs }>`, keyed `JSON.stringify([projectId, script])`, holds the stores. Inside the effect:
    1. Acquire the store.
    2. Subscribe to `tools:event` first.
    3. Fetch the `replace` snapshot only if the store is new.
    4. On `'gap'`, fetch a delta with `afterSeq: store.lastSeq`.
    5. On cleanup, release; `refs === 0` deletes the store.
  - **Cap.** The cap comes from `useSettings().data?.logBufferLines ?? 50_000`.
  - **Reading.** Read through `useSyncExternalStore`.
- [ ] **Step 4:** Run `pnpm vitest run --project renderer`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scripts): renderer log line store with snapshot, batches and resync`

---

### Task 19: Log pane

**Files:**
- Create: `src/renderer/tools/scripts/LogPane.tsx`, `LogPane.test.tsx`, `LogRow.tsx`, `LogToolbar.tsx`
- Modify: `package.json` (`@tanstack/react-virtual` devDependency)

**Interfaces:**

```ts
export interface LogPaneProps {
  projectId: string;
  script: string | null;
  scripts: string[];                    // for the picker
  onScriptChange(script: string): void;
  active: boolean;                      // highlighted border when it's the pane that script clicks target
  onActivate(): void;
}
```

- [ ] **Step 1: Install** with `pnpm add -D @tanstack/react-virtual@3.14.13`.

- [ ] **Step 2: Write the failing tests** (`LogPane.test.tsx`, using the mock bridge and `renderWithProviders`)
  - **No script:** shows "Pick a script to see its output."
  - **Plain lines:** they render with ANSI classes. A `\x1b[31m` piece has class `ansi-fg-1`, and there's no `dangerouslySetInnerHTML`; assert `container.innerHTML` holds no raw `\x1b`.
  - **Rows:**
    - a structured pino line renders a level badge `INFO`, the context `[Http]` and the message;
    - clicking it expands formatted JSON (`aria-expanded` toggles);
    - stderr lines carry `data-stream="stderr"`, and system lines are muted.
  - **Level filter:** selecting `error` hides plain lines. The toolbar shows "Plain lines hidden while filtering".
  - **Search:**
    - typing `boom` marks the hits (`<mark>`) and shows `1 / 2`;
    - next and previous cycle, and Enter goes to the next hit.
  - **Link:** clicking `src/a.ts:12` calls `scripts.openFileAt` with `{ path: 'src/a.ts', line: 12 }`.
  - **Export:**
    - with no filter, sends `seqs: 'all'`;
    - with a level filter, sends the visible seqs;
    - with more than 100 000 visible lines under a filter, shows a toast and sends nothing.
  - **Clear:** calls `clearLogs`, and the list empties.
  - **Follow:**
    - on by default;
    - a scroll event with `scrollTop + clientHeight < scrollHeight - 4` turns it off (`aria-pressed="false"`);
    - clicking Follow turns it back on.

    Define `scrollHeight` and `clientHeight` with `Object.defineProperty` on the scroll element.

- [ ] **Step 3: Run them to see them fail.**

- [ ] **Step 4: Implement**
  - **`LogPane`**
    - Calls `useLogStream`, then derives `visible = useMemo(() => visibleLines(lines, filters))`, `hits = useMemo(() => searchHits(visible, query))` and `contexts = useMemo(() => contextsOf(lines))`.
    - The virtualizer:

      ```ts
      const virtualizer = useVirtualizer({
        count: visible.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => 20,
        overscan: 20,
        getItemKey: (i) => visible[i]?.seq ?? i,
        initialRect: { width: 800, height: 600 }, // jsdom has no layout; harmless in Electron
      });
      ```

      Rows use `ref={virtualizer.measureElement}` and `data-index`, so expanded rows measure correctly.
    - **Follow:** when it's on and `visible.length` changes, call `virtualizer.scrollToIndex(visible.length - 1, { align: 'end' })`. `onScroll` sets follow to whether the view is at the bottom (4 px tolerance). Search navigation turns follow off and scrolls to the hit.
    - **Layout:** rows don't wrap (`whitespace-pre`). The scroller is `overflow-auto` with `font-mono text-[12px] leading-5`.
  - **`LogRow`**
    - **Plain row:** a muted `HH:MM:SS.mmm` time (local), then the pieces from `decorate(parseAnsi(text), findLinks(stripped), findMatches(stripped, query))`.
      - Links are `<button type="button" className="underline decoration-dotted hover:text-brand">` and call `openFileAt`.
      - Matches are `<mark className="bg-warn/30 text-fg">`, and the current hit gets `ring-1 ring-warn`.
      - Link ranges come from the ANSI-stripped text. `decorate` must use the same coordinates: build the segments from `parseAnsi`, whose concatenated text equals `stripAnsi(text)`, and test that invariant.
    - **Structured row:**
      - time from `time ?? ts`, then a level badge (tinted background and border, like the existing badges: error/fatal `err`, warn `warn`, info `brand`, debug/trace `idle`), then `[context]` in `text-brand`, then the message;
      - a muted `requestId` on the right;
      - a toggle button with `aria-expanded`;
      - when expanded, `<pre>` holds `JSON.stringify(raw, null, 2)`.
    - **System rows** are `text-fg-faint italic`.
  - **`LogToolbar`**
    - the script picker, as a native `<select>` styled like `Input`, or shadcn `Select` once it's added in Task 24 (pick one and keep it consistent);
    - search with `n / m` and previous/next;
    - level toggles (`trace` … `fatal`, `aria-pressed`);
    - a context `<select>` ("All contexts" plus `contexts`);
    - a `requestId` input;
    - Follow (`aria-pressed`), Clear and Export.
  - **Accessibility.** The list is `role="log"` with `aria-live="off"` (log streams are too chatty for live regions) and `aria-label="<script> output"`.
- [ ] **Step 5:** Run `pnpm vitest run --project renderer && pnpm lint && pnpm typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(scripts): virtualised log pane with ANSI, JSON rows, search, filters and export`

---

### Task 20: Scripts panel, run groups, overview card and navigation

**Files:**
- Create: `src/renderer/tools/scripts/ScriptList.tsx`, `ScriptList.test.tsx`, `RunGroups.tsx`, `RunGroups.test.tsx`, `Panel.tsx`, `Panel.test.tsx`, `OverviewCard.tsx`, `index.ts`, `src/renderer/lib/navigate.ts`, `src/renderer/lib/navigate.test.tsx`
- Modify: `src/renderer/tools/registry.ts`, `src/renderer/tools/icons.ts` (`terminal` → `SquareTerminal`), `src/renderer/state/ui-store.ts`, `src/renderer/app/App.tsx`

**Interfaces:**

```ts
// ui-store additions
scriptPanes: Record<string, { scripts: (string | null)[]; active: number }>; // 1 or 2 panes per project
showScript(projectId: string, script: string): void;   // into the active pane
setPaneScript(projectId: string, pane: number, script: string): void;
setActivePane(projectId: string, pane: number): void;
toggleSplit(projectId: string): void;                  // 1 ↔ 2 panes; closing keeps pane 0

// navigate.ts
export function useNavigateSubscription(): void; // app:navigate → select(projectId), setActiveTab(projectId, tab), showScript if script
```

- [ ] **Step 1: Write the failing tests**
  - **`ScriptList`:**
    - one row per script with its command;
    - Start, Stop and Restart buttons (accessible names `Start dev`, `Stop dev`, `Restart dev`) appear according to the state: Start when not live, Stop and Restart when live;
    - clicking Start calls `scripts.start({ script: 'dev' })`;
    - a `starting` state shows an amber badge "starting";
    - a `crashed` summary shows `exit 1 · Error: boom` and `3 crashes`;
    - `gaveUp` shows "gave up after 5 crashes";
    - `nextRestartAt` shows "restarting…";
    - the auto-restart switch (`Auto-restart dev`) calls `setAutoRestart`;
    - clicking the script name calls `showScript`;
    - a `CONFLICT` from start shows a toast.
  - **`RunGroups`:**
    - lists the groups with Start and Stop;
    - Start calls `startRunGroup` and, when `skipped` isn't empty, toasts "Skipped 1 script: packages/gone dev (missing)";
    - "New group" opens a dialog with a name input and checkboxes grouped by package (Root, `packages/api`);
    - Save calls `saveRunGroup` with the entries in the order checked;
    - an empty name or no entries keeps Save disabled;
    - Edit pre-fills and sends `previousName`;
    - Delete confirms through `AlertDialog`;
    - the section is absent on a workspace project (`runGroups: null`).
  - **`Panel`:**
    - renders the list and one pane;
    - "Split" adds a second pane, and clicking a script name fills the active pane;
    - the panes keep their scripts after a tab switch, because the state is in the store.
  - **`navigate.test.tsx`:** emitting `app:navigate { projectId: 'p1', tab: 'scripts', script: 'dev' }` selects `p1`, opens the Scripts tab and puts `dev` in the active pane. An invalid payload is ignored.
  - **`OverviewCard`:**
    - lists the live and crashed processes of the project and its workspaces with state dots;
    - "No scripts running" when there are none;
    - "Open Scripts" sets the active tab.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.**
  - **Panel layout:** `grid h-full grid-cols-[320px_1fr] gap-4`.
    - The left column scrolls: `RunGroups` (root only), then `ScriptList`.
    - The right column is a flex row of one or two `LogPane`s, with a "Split" toggle in the panel header (lucide `Columns2`).
    - The active pane gets `border-brand`, and the others `border-line`.
  - **Containment:** `ProjectView` puts tool panels inside `overflow-y-auto p-6`, but the Scripts panel needs the full height. Give `RendererTool` an optional `fullHeight?: boolean`. `ProjectView` then uses `overflow-hidden` with the panel at `h-full` for such tools. Test that the Project info panel still scrolls.
  - **Registration:** add `scriptsRendererTool = { id: 'scripts', Panel: lazy(() => import('./Panel')), OverviewCard: ScriptsCard, fullHeight: true }`.
  - **Styling:** follow the prototype's look (DESIGN-NOTES "Take from the prototype": log viewer look, badges, cards) using only tokens.
- [ ] **Step 4:** Run `pnpm test && pnpm lint && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scripts): scripts panel with run groups, split panes, overview card and navigation`

---
### Task 21: Tray and crash notifications

**Files:**
- Create: `src/main/tray/tray-menu.ts`, `tray-menu.test.ts`, `crash-notifier.ts`, `crash-notifier.test.ts`, `tray-controller.ts` (all under `src/main/tray/`)
- Modify: `src/main/platform/adapter.ts`, `win32.ts`, `darwin.ts` (and their tests), `src/main/index.ts`

**Interfaces:**

```ts
// tray-menu.ts (pure; imports only types from electron)
export interface TrayProcess { projectId: string; script: string; label: string; state: ProcessState }
export interface TrayProject { id: string; name: string; processes: TrayProcess[]; runGroups: string[] }
export interface TrayModel { projects: TrayProject[] }       // every stored root project
export interface TrayActions {
  show(): void; quit(): void;
  stop(projectId: string, script: string): void;
  restart(projectId: string, script: string): void;
  showLogs(projectId: string, script: string): void;
  startRunGroup(rootId: string, name: string): void;
  openInEditor(rootId: string): void;
}
export function buildTrayModel(projects: ProjectSummary[], processes: ProcessSummary[], runGroups: (rootId: string) => RunGroup[]): TrayModel;
export function buildTrayMenu(model: TrayModel, actions: TrayActions): MenuItemConstructorOptions[];
export function trayTooltip(processes: readonly ProcessSummary[]): string;
export function resolveTrayTheme(setting: TrayIconTheme, systemDark: boolean): 'dark-taskbar' | 'light-taskbar';
export function trayIconPaths(theme: 'dark-taskbar' | 'light-taskbar', state: AggregateState): { x1: string; x2: string };

// crash-notifier.ts
export function crashNotice(summary: ProcessSummary, projectName: string): { title: string; body: string };

// adapter
notificationAppId(): string | null;   // win32: 'dev.nestbox.app' (matches electron-builder appId); darwin: null
```

- [ ] **Step 1: Write the failing tests**
  - **`buildTrayModel`:**
    - a project's processes include its workspaces', labelled `api · dev`;
    - only states other than `stopped` and `exited` appear: live and crashed ones;
    - projects without processes keep an empty list, because they still feed the "Open in VS Code" and "Run groups" submenus.
  - **`buildTrayMenu`:**
    1. For each project with processes, a submenu titled with the project name holds each process as a submenu (`dev — running`) with Stop, Restart and Show logs. Clicking Stop calls `actions.stop('p1', 'dev')`.
    2. Next comes a separator and "Run groups", containing `shop › dev` items. It's disabled when there are no groups.
    3. Then "Open in VS Code" with one item per project.
    4. Finally a separator, "Show Nestbox" and "Quit Nestbox".
    5. When no project has processes, the first section is a disabled "No scripts running".
  - **`trayTooltip`:**
    - `Nestbox` when idle;
    - `Nestbox: 2 running` when running;
    - `Nestbox: 1 crashed, 2 running` with a crash.
  - **`resolveTrayTheme('auto', true)`** gives `dark-taskbar`, and an explicit setting wins.
  - **`trayIconPaths('dark-taskbar', 'crashed')`** gives `png/tray/tray-dark-taskbar-crashed-16.png` and `-32.png`.
  - **`crashNotice`:**
    - gives `{ title: 'Nestbox', body: 'api crashed in shop (exit 1)' }`, the design's wording;
    - a signal gives `api crashed in shop (killed by SIGTERM)`;
    - `gaveUp` gives `api crashed in shop and gave up after 5 crashes`;
    - a workspace process uses the label `shop · api`;
    - the body never includes `exit.lastLine` (it may hold secrets printed by the script).
  - **Adapters:** `notificationAppId()` is `dev.nestbox.app` on win32 and `null` on darwin.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement**
  - **`TrayController`** (`tray-controller.ts`) is thin Electron wiring and isn't unit-tested. Its deps are:
    - `Tray`, `Menu`, `nativeImage` and `nativeTheme`;
    - `assetPath(rel)`, which is `brandAsset`;
    - `getModel(): Promise<TrayModel>`;
    - `getProcesses()`;
    - `getSettings()`;
    - `actions`.
  - **`refresh()`:**
    1. Build the image from the 16 px file with `nativeImage.createFromPath`.
    2. Add the 32 px file through `image.addRepresentation({ scaleFactor: 2, buffer: nativeImage.createFromPath(x2).toPNG() })`.
    3. Then call `setImage`, `setToolTip` and `setContextMenu(Menu.buildFromTemplate(...))`.
  - **Refresh triggers:**
    - the throttled `processes` `changed`;
    - `projects:changed`;
    - `onSettingsChanged`;
    - `nativeTheme.on('updated')`.
  - **Activation:** a left click and a double click call `show()`.
  - **Wiring in `index.ts`**, after the window exists:
    1. If `platform.notificationAppId()` returns an id, call `app.setAppUserModelId(id)` first.
    2. Create the tray.
    3. Subscribe to `crashed` events with `final === true`: when `Notification.isSupported()`, show `new Notification({ ...crashNotice(summary, projectName), icon })`. Its `click` calls `actions.showLogs`.

    Windows only shows toasts for an app with an AppUserModelID that a Start-menu shortcut also carries. An installed build has that shortcut; `pnpm dev` may not show toasts at all. That's a known Electron limitation, not a bug to chase in M1. The manual checklist tests notifications in a packaged build if `pnpm dev` shows none, and the PR notes the result.
  - **Actions:**
    - `show`: restore the window if minimised, then `show()` and `focus()`;
    - `showLogs`: `show()`, then `emit('app:navigate', { projectId, tab: 'scripts', script })`;
    - `stop`/`restart`: call the manager (`restart` re-uses the entry's last `StartRequest` through a new `ProcessManager.restartExisting(projectId, script)`; add it with a test in `process-manager.test.ts`);
    - `startRunGroup`: invoke the scripts tool through `toolHost.invoke('scripts', rootId, 'startRunGroup', { name })`;
    - `openInEditor`: the same path as `projects:openInEditor`, with errors shown through `dialog.showErrorBox`;
    - `quit`: `quitController.requestQuit()` (Task 22).
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tray): state icon, process menu, run groups and crash notifications`

---

### Task 22: Close to tray, confirmed quit and graceful shutdown

**Files:**
- Create: `src/main/lifecycle/quit-controller.ts`, `src/main/lifecycle/quit-controller.test.ts`
- Modify: `src/main/index.ts`, `src/main/window.ts`

**Interfaces:**

```ts
export const SHUTDOWN_TIMEOUT_MS = 5_000;

export interface QuitControllerDeps {
  liveCount(): number;
  confirmQuit(liveCount: number): Promise<boolean>;
  /** Stops processes and disposes tools; resolves when done (the controller applies the timeout). */
  shutdown(): Promise<void>;
  quit(): void;                 // app.quit()
  closeToTray(): boolean;
  hideWindow(): void;
  logger: Logger;
  timeoutMs?: number;
}

export interface QuitController {
  /** app 'before-quit' */
  onBeforeQuit(event: { preventDefault(): void }): void;
  /** BrowserWindow 'close' */
  onWindowClose(event: { preventDefault(): void }): void;
  /** BrowserWindow 'session-end' (Windows logoff/shutdown): no confirm. */
  onSessionEnd(): void;
  requestQuit(opts?: { confirm?: boolean }): Promise<boolean>;
}
export function createQuitController(deps: QuitControllerDeps): QuitController;
```

- [ ] **Step 1: Write the failing tests**
  - **Window close:**
    - with `closeToTray` on, `onWindowClose` prevents the default and hides, and `quit` isn't called;
    - with it off, it prevents the default and starts `requestQuit`.
  - **Confirmation:**
    - with no live processes, `requestQuit` calls `shutdown` then `quit` without confirming;
    - with 2 live processes it calls `confirmQuit(2)`. A false answer means no shutdown and no quit, and returns `false`. A true answer means shutdown, then quit.
  - **`onBeforeQuit`:**
    - prevents the first time and runs the flow;
    - after the flow calls `quit()`, the second `before-quit` passes through without prevention (the guard flag);
    - `onWindowClose` after that guard is set doesn't prevent either, so the window can close during quit.
  - **Hanging shutdown** (Review focus 8): with a shutdown that never resolves, `quit` is called after `timeoutMs`, and `shutdown timed out` is logged with `{ ms }`.
  - **Concurrency:** a second `requestQuit` while one is in flight returns `false`, and confirm is called once.
  - **`onSessionEnd`:** skips confirm even with live processes.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** the controller. The flow uses `allow`/`inProgress` flags, and `Promise.race([shutdown().then(() => true), delay(timeoutMs).then(() => false)])`.

  Wiring in `index.ts`:
  - **`shutdown`:**
    1. `await Promise.allSettled([processes.stopAll(), toolHost.disposeAll(SHUTDOWN_TIMEOUT_MS - 500)])`.
    2. Then `ledger.clear()`, only reached when the processes stopped.
    3. Log the `disposeAll` result's `failed` and `timedOut` tool ids.
  - **`confirmQuit`:**

    ```ts
    dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Stop and quit', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: `Stop ${n} running script${n === 1 ? '' : 's'} and quit?`,
      detail: 'Nestbox stops the scripts it started before quitting.',
    })
    ```

    It resolves to `response === 0`.
  - **Events:**
    - `app.on('before-quit', quitController.onBeforeQuit)`;
    - `win.on('close', quitController.onWindowClose)`;
    - `win.on('session-end', quitController.onSessionEnd)`.
  - **Remove:** `app.on('window-all-closed', …quit)` (design: "`window-all-closed` no longer quits by itself"), and replace it with a no-op handler so Electron's default quit doesn't apply. Also remove M0's `void toolHost.disposeAll()`.
  - **Ctrl+Q:** in `window.ts`, `webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'q') { e.preventDefault(); void requestQuit(); } })`. Pass it in as an `onQuitShortcut` option.
  - **Second launch:** `second-instance` must also `show()` a hidden window, not just focus it.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(main): close to tray, confirmed quit and graceful shutdown with timeout`

---

### Task 23: Orphan prompt on startup

**Files:**
- Create: `src/main/lifecycle/orphan-prompt.ts`, `src/main/lifecycle/orphan-prompt.test.ts`
- Modify: `src/main/index.ts`

**Interfaces:**

```ts
export interface OrphanPromptDeps {
  ledger: Pick<PidLedger, 'previous' | 'dropPrevious'>;
  startTimeOf(pid: number): Promise<number | null>;
  killTree(pid: number): Promise<void>;
  projectName(projectId: string): string | null;
  /** Resolves true for "Stop them". */
  ask(message: string, detail: string): Promise<boolean>;
  logger: Logger;
}
export async function handleOrphans(deps: OrphanPromptDeps): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**
  - With no previous entries, it doesn't ask, and `dropPrevious` is called.
  - With entries but no matches, it doesn't ask, and `dropPrevious` is called.
  - Two matches give `ask('2 scripts from the last session are still running', 'shop · dev (PID 1000)\nshop · api · dev (PID 1001)')`:
    - "Stop them" calls `killTree` for both;
    - a `killTree` failure is logged with `{ pid }` and the other still runs;
    - then `dropPrevious`.
  - "Leave running" calls no `killTree`, and `dropPrevious` is still called.
  - An unknown project id shows as `unknown project`.
  - A throw inside (for example from `ask`) is logged as `orphan check failed`, and `dropPrevious` is **not** called, so the prompt comes back on the next start.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement** with `findOrphans` (Task 11). Wire it in `index.ts` on `win.once('ready-to-show', …)` after the show, wrapped so a failure is logged and nothing more.
  - `ask` uses `dialog.showMessageBox(win, { type: 'warning', buttons: ['Stop them', 'Leave running'], defaultId: 0, cancelId: 1, message, detail })`.
  - Project names come from `store.getProjects()`. A workspace label is the root name plus the relPath's last segment.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(main): offer to stop scripts left running by a crashed session`

---

### Task 24: Settings dialog and the read-only warning

**Files:**
- Create: `src/renderer/app/SettingsDialog.tsx`, `src/renderer/app/SettingsDialog.test.tsx`
- Add through the shadcn CLI: `src/renderer/components/ui/dialog.tsx`, `switch.tsx`, `select.tsx` (`pnpm dlx shadcn@4.21.0 add dialog switch select`). Then apply the CLAUDE.md gotchas: rewrite any `cn` import to `@/lib/utils`, move `radix-ui` to devDependencies if the CLI moved it, and revert any change to `globals.css`.
- Modify: `src/renderer/app/TitleBar.tsx`, `src/renderer/app/StatusBar.tsx`, `src/renderer/app/StatusBar.test.tsx`, `src/renderer/state/ui-store.ts` (`settingsOpen`)

- [ ] **Step 1: Write the failing tests**
  - **Opening:** the title bar has a `Settings` button (`no-drag`). Clicking it opens a dialog titled "Settings".
  - **Fields:** the dialog shows the current values from `settings:get`:
    - "Close to tray" is a switch;
    - "Tray icon theme" is a select: Automatic, Dark taskbar, Light taskbar;
    - "Log buffer" is a number input with the hint "lines per script, 1 000–1 000 000";
    - "Editor command" is a text input with the hint "Used by Open in VS Code and log links".
  - **Save:**
    - sends only the changed fields (`settings:update` gets `{ closeToTray: false }`);
    - closes the dialog;
    - updates the cached settings.
  - **Validation:**
    - `logBufferLines` 999 shows an inline error and disables Save;
    - an editor command containing `"` shows "Quotes are not allowed";
    - both rules reuse the shared Zod schemas from `@shared/settings`.
  - **Read-only:** when `readOnly` is true, the fields are disabled and a note says "Settings are read-only because the settings file couldn't be saved or comes from a newer Nestbox."
  - **Status bar:** it shows "Settings are read-only" (`text-warn`, with a lucide `TriangleAlert` icon) when `readOnly`.
  - **Errors:** a server `INTERNAL` error shows a toast and keeps the dialog open.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** Keep the dialog small, with labels on the left and controls on the right, in the existing card styling. There's no light theme, so it has no theme setting.
- [ ] **Step 4:** Run `pnpm test && pnpm lint && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(renderer): settings dialog and read-only warning`

---

### Task 25: UI follow-ups from the M0 reviews

**Files:**
- Modify: `src/renderer/lib/queries.ts`, `src/renderer/app/Sidebar.tsx`, `src/renderer/app/Sidebar.test.tsx`, `src/renderer/app/ToolTabs.tsx`, `src/renderer/app/ProjectView.tsx`, `src/renderer/app/ProjectView.test.tsx`, `src/renderer/tools/project-info/OverviewCard.tsx`
- Create: `src/renderer/app/ToolTabs.test.tsx`, `src/renderer/tools/project-info/OverviewCard.test.tsx`, `src/renderer/lib/queries.test.tsx` additions

- [ ] **Step 1: Write the failing tests**
  - **`projects:changed` invalidation:** it invalidates `['projects']`, `['tools']` and `['tool']` (spy on `queryClient.invalidateQueries`). It also invalidates `['tool', 'scripts', …, 'list']`, which `['tool']` covers.
  - **Sidebar counts:**
    - with no filter, "All projects" shows the total;
    - with a filter, it shows `2 of 5` and Pinned shows its filtered count;
    - with a filter that matches nothing, a "No projects match “zzz”" row appears with a "Clear filter" button that empties the filter.
  - **Project info card:**
    - shows a skeleton (`aria-busy="true"`, three placeholder lines) while pending;
    - shows "Couldn't load project info" with a Retry button that refetches when the query fails.
  - **`ToolTabs`:**
    - `role="tablist"`;
    - each tab has `id="tab-<projectId>-<toolId>"`, `aria-controls="panel-<projectId>"` and `tabIndex` 0 when selected, -1 otherwise;
    - ArrowRight, ArrowLeft (wrapping), Home and End move the focus and select (automatic activation);
    - `ProjectView` renders `role="tabpanel"` with `id="panel-<projectId>"`, `aria-labelledby` set to the active tab's id, and `tabIndex={0}`.

  Per CLAUDE.md, tests wait with `findBy*`, and product markup isn't changed for test timing.
- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** `ToolTabs` takes a `projectId` prop. Keep a ref array of tab buttons, and have `onKeyDown` compute the next index and call `onSelect(id)` and `.focus()`.
- [ ] **Step 4:** Run `pnpm vitest run --project renderer`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(renderer): filtered counts, no-match hint, card states, accessible tabs, tool query invalidation`

---

### Task 26: M0 test gaps

**Files:**
- Modify: `src/renderer/app/App.test.tsx`, `src/renderer/lib/queries.test.tsx`, `src/renderer/app/TitleBar.test.tsx` (create if absent), `src/main/projects/project-service.test.ts` (if Task 6 didn't already cover "add when detect throws")

- [ ] **Step 1: Write the tests.** These cover behaviour that already exists, so they may pass at once. If one fails, it has found a bug: fix the code in this task and say so in the commit body.
  - **Pending state:** while `projects:list` is unresolved, `App` renders no `EmptyState` (no "Add your first project") and no project view.
  - **Stale selection:** with `selectedProjectId` set to an id that is no longer listed, `App` shows the first project, and the sidebar marks it `aria-current="page"`.
  - **Mutation hooks:**
    - rename, pin, refresh, open in editor and open terminal each call their channel with the right input;
    - each shows a toast with the error message on failure;
    - refresh invalidates `projects`, `tools` and `tool`;
    - the open-terminal and open-in-editor hooks invalidate `projects` on error.
  - **Title bar:**
    - with a workspace selected, it shows `shop · api` and the branch;
    - with a root selected, it shows only the name;
    - with nothing selected, there's no centre text.
- [ ] **Step 2:** Run `pnpm test`. Expected: PASS.
- [ ] **Step 3: Commit** `test: cover pending state, stale selection, mutation hooks and title bar`

---

### Task 27: Playwright end-to-end tests and CI job

**Files:**
- Create: `e2e/playwright.config.ts`, `e2e/scripts.spec.ts`, `e2e/helpers.ts`, `e2e/fixtures/npm-app/package.json`, `e2e/fixtures/npm-app/package-lock.json`, `e2e/fixtures/npm-app/server.js`
- Modify: `package.json` (`@playwright/test` devDependency, `"e2e": "playwright test -c e2e/playwright.config.ts"`), `tsconfig.node.json` (include `e2e/**/*`), `src/main/index.ts`, `.github/workflows/ci.yml`, `.gitignore` (`test-results/`, `playwright-report/`)

- [ ] **Step 1: Install** with `pnpm add -D @playwright/test@1.63.0`. Don't run `playwright install`, because Electron brings its own Chromium.

- [ ] **Step 2: Allow an isolated user-data folder.** At the top of `index.ts`, before the single-instance lock (which is keyed on `userData`):

```ts
const userDataOverride = app.isPackaged ? undefined : process.env['NESTBOX_USER_DATA_DIR'];
if (userDataOverride) app.setPath('userData', userDataOverride);
```

- [ ] **Step 3: The fixture app.**
  - `package.json` scripts:
    - `"serve": "node server.js"`;
    - `"boom": "node -e \"console.error('kaboom'); process.exit(3)\""`.
  - `server.js` writes `process.pid` to `./server.pid`, prints `listening`, and stays alive with `setInterval`.
  - `package-lock.json` is a minimal valid v3 lockfile with no dependencies, so detection picks `npm`.

- [ ] **Step 4: Write the spec**

```ts
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
// helpers: copyFixture() → temp dir; tempUserData(); isAlive(pid) via process.kill(pid, 0)

let app: ElectronApplication;
let page: Page;
let project: string;

test.beforeEach(async () => {
  project = await copyFixture('npm-app');
  app = await electron.launch({ args: ['.'], env: { ...process.env, NESTBOX_USER_DATA_DIR: await tempUserData() } });
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
  }, project);
  page = await app.firstWindow();
  // Close the window quits instead of hiding, so app.close() can finish.
  await page.evaluate(() => window.nestbox.invoke('settings:update', { closeToTray: false }));
});

test.afterEach(async () => {
  // The quit test closes the app itself.
  if (app.process().exitCode === null) await app.close();
});

test('runs a script, shows its output and stops the whole tree', async () => {
  await page.getByRole('button', { name: 'Add project' }).click();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'Start serve' }).click();
  await expect(page.getByRole('log', { name: 'serve output' })).toContainText('listening');
  const pid = Number(await readFile(join(project, 'server.pid'), 'utf8'));
  expect(isAlive(pid)).toBe(true);
  await page.getByRole('button', { name: 'Stop serve' }).click();
  await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false);
});

test('shows a crashed script with its exit code and last line', async () => {
  await page.getByRole('button', { name: 'Add project' }).click();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'Start boom' }).click();
  await expect(page.getByText('exit 3 · kaboom')).toBeVisible();
});

test('quitting with a running script stops it', async () => {
  // start serve, read the pid, app.close() (the stubbed confirm answers "Stop and quit"), then poll isAlive(pid) → false
});
```

  `playwright.config.ts`: `testDir: '.'`, `timeout: 60_000`, `workers: 1`, `retries: 0` ("flake" is not a root cause), `reporter: [['list']]`, `use: { trace: 'retain-on-failure' }`. The spec files are `*.spec.ts`, which Vitest's `*.test.ts` include patterns don't pick up.

- [ ] **Step 5: The CI job.** Add to `.github/workflows/ci.yml`:

```yaml
  e2e:
    name: e2e (windows-latest)
    runs-on: windows-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile   # downloads the Electron binary (no ELECTRON_SKIP_BINARY_DOWNLOAD)
      - run: pnpm build
      - run: pnpm e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: test-results/
```

  Before relying on the `upload-artifact` version, check the newest major that the existing actions' generation uses (they're `@v7` for checkout and setup-node), and pin to the current major of `actions/upload-artifact`.

- [ ] **Step 6:** Locally, run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. The end-to-end tests can't run in the Linux container (Windows-only spawning), so push and confirm the `e2e` job is green on GitHub Actions. If it fails, read the trace artifact, root-cause the failure and fix it. Never mark the job `continue-on-error`.
- [ ] **Step 7: Commit** `test(e2e): Playwright Electron tests for running, crashing and quitting scripts`

---

### Task 28: Spec and docs

**Files:**
- Modify: `docs/nestbox-spec.md`, `CLAUDE.md`, `docs/superpowers/HANDOFF.md`, `docs/superpowers/specs/2026-10-01-nestbox-m1-design.md` (status line)

- [ ] **Step 1: `docs/nestbox-spec.md`.**
  - In the data model:
    - `runGroups: { name: string; entries: { relPath: string; script: string }[] }[]`;
    - `AppSettings.trayIconTheme: 'auto' | 'dark-taskbar' | 'light-taskbar'`;
    - `schemaVersion` sits at the store root, matching what M0 shipped.
  - In the PlatformAdapter block: add `processStartTime(pid)` and `notificationAppId()`.
  - Add a one-line note under the Tool interface: `ToolContext` has `settings`, and tools that need core services are built by factories.
- [ ] **Step 2: `CLAUDE.md`.**
  - **Commands:** add `pnpm e2e` (Playwright Electron, needs `pnpm build` and the Electron binary; runs on Windows CI).
  - **Folder structure:** add `processes/` (ProcessManager, ring buffer, ledger), `tray/` and `lifecycle/` (quit controller, orphans).
  - **"Adding a tool":**
    - step 3 becomes "a factory or object, registered in `createMainTools`";
    - handlers get `ctx.settings`;
    - events are declared with `defineEvents` and registered in `toolEvents`;
    - the renderer listens with `useToolEvent`;
    - full-height panels set `fullHeight`.
  - **IPC:** list the new core channels and events.
  - **Gotchas:**
    - react-virtual needs `initialRect` in jsdom;
    - `NESTBOX_USER_DATA_DIR` is honoured only unpackaged;
    - the PID ledger lives in `userData/processes.json`;
    - log text never goes renderer → main.
- [ ] **Step 3: `HANDOFF.md`.** Update the state to M1 done, with the PR link and the test count, and move the M1 follow-ups to "done". Keep the M2 and M3 follow-ups, plus any new follow-ups raised by M1's review.
- [ ] **Step 4:** Run `pnpm format:check` on the changed docs.
- [ ] **Step 5: Commit** `docs: record M1 architecture, commands and handoff`

---

### Task 29: Verification, review and the PR

- [ ] **Step 1: Verification before completion.** Run each of these and read its output; don't infer success:
  ```bash
  pnpm lint && pnpm typecheck && pnpm test && pnpm build
  ```
  Then push, and confirm on GitHub Actions that the `windows-latest`, `macos-latest` and `e2e (windows-latest)` jobs are green on the head commit.
- [ ] **Step 2: Request code review** (superpowers:requesting-code-review, or the `code-review` skill at high effort) on the full diff against `main`. Fix every correctness finding with a test first. Record anything deferred in `HANDOFF.md` under the right milestone.
- [ ] **Step 3: Security pass.** Check that:
  - no log call passes env, line text or paths;
  - every new IPC channel validates its input;
  - export reads only from main's buffer;
  - `openFileAt` can open only existing regular files;
  - notifications never include log text.
- [ ] **Step 4: Manual checklist for the owner** (on Windows; from the design's "Manual verification"). Put it in the PR body as unchecked boxes:
  - [ ] `pnpm dev` with a real monorepo; Scripts tab on root and on a workspace package
  - [ ] Run group API + web starts both; split panes show each
  - [ ] Crash one (kill its port's owner, or a script that exits 1): row shows exit code and last line; tray turns red; notification names it; clicking the notification opens its logs
  - [ ] Auto-restart on: backoff lines appear; gives up after 5
  - [ ] JSON logs (NestJS or pino): level filter, context filter, request id filter; expand a row
  - [ ] Click a stack-trace link: VS Code opens at the line
  - [ ] Export with and without a filter
  - [ ] Close the window: app stays in the tray; Show Nestbox restores it
  - [ ] Quit from the tray with scripts running: confirm, then no leftover `node.exe` in Task Manager
  - [ ] Kill Nestbox from Task Manager with a script running, start it again: the orphan prompt lists it; "Stop them" ends it
  - [ ] Settings: change the tray theme and editor command; a missing editor gives the "not found on PATH" toast
- [ ] **Step 5:** Mark the draft PR ready only when everything above is done, and stop with a milestone summary for the owner.
