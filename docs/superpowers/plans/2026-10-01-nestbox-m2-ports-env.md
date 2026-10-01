# NestBox M2 (Ports and env) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-01-nestbox-m2-design.md` (decisions referenced as D1…D16).
> Branch: `m2-ports-env` from `main` (after PR #2). One PR, merged to `main` when the owner has tested it.
> Every task is TDD: write the failing Vitest test next to the source, see it fail, implement, see it pass, then `pnpm typecheck && pnpm lint && pnpm test`. Conventional commits, one or more per task, with the session trailer.

**Goal.** A global Ports page with attribution and safe kills, `EADDRINUSE` "kill and restart", a watch list on the Overview, and an env tool (matrix, flags, masked values, copy without reveal, edits that keep formatting, profiles), plus the HANDOFF M2 follow-ups.

**Order.** Core follow-ups → ports (adapter → service → channels → UI) → env (parser → tool main → UI) → e2e → docs. Ports and env don't depend on each other after Task 3, so they can be reviewed separately.

---

## Part A: Core follow-ups

### Task 1: Detection follow-ups (D-HANDOFF)

**Files:** `src/main/detection/detect-project.ts`, `fs-utils.ts`, `detect-project.test.ts`.

1. Tests:
   - `.envrc` and `.envrc.d` are not env files; `.env`, `.env.local`, `.env.production.local` are.
   - A directory named `.env.d` is not listed (existing test keeps passing).
   - An env file that is a symlink stays in `envFiles` and is also listed in a new `envSymlinks: string[]`, so the env tool can mark it read-only.
   - `readdir` failure on a workspace folder calls `onWarning(relPath, 'unreadable')` and still returns the other packages.
   - A workspace glob that matches a symlinked directory resolving outside the root is skipped with `onWarning(relPath, 'outside-root')`.
2. Implement: pattern `/^\.env(\..+)?$/`; `lstat` for env entries; `realpath` check for workspace dirs (`isInside(root, real)` using `samePath`-style comparison through an injected `normalize`).
3. `DetectedProjectSchema` gains `envSymlinks: z.array(z.string()).default([])`.

### Task 2: `getDetected` waits for in-flight detection (D16)

**Files:** `src/main/projects/project-service.ts` (+ test), `src/main/tools/tool-host.ts` (+ test), `src/main/tools/scripts/index.ts` deps.

1. Test: `getDetectedAsync(id)` resolves after `init()`'s detection of that project finishes; throws NOT_FOUND for an unknown id immediately; throws NOT_FOUND after the detection timeout (fake timers).
2. Implement `getDetectedAsync` using the existing in-flight promise map; keep the sync `getDetected` for the tray and labels.
3. Tool host `getProject` becomes async; `invoke` awaits it. Update the tool-host test that expected NOT_FOUND during detection: it now resolves.
4. Remove the renderer's "retry every 2 s" comment in `use-log-stream.ts` only if the retry is no longer needed for this case (keep the retry: it also covers other errors).

### Task 3: `watchedPorts` setting (D6)

**Files:** `src/shared/types.ts`, `src/shared/settings.ts`, `src/renderer/app/SettingsDialog.tsx` (+ tests), `src/main/ipc/core-handlers.ts` (+ test).

1. Tests: `AppSettingsSchema.parse({})` includes `watchedPorts: [3000, 5173, 5432, 6379, 8080]`; an existing v2 store without the field loads with the default (no migration); `SettingsPatchSchema` accepts 0–20 unique ports 1–65535 and rejects others; the dialog edits the list as a comma-separated input ("3000, 5173") with an inline error.
2. Implement. `CURRENT_SCHEMA_VERSION` stays 2.

---

## Part B: Ports

### Task 4: netstat and tasklist parsers (D-Ports)

**Files:** `src/main/platform/win32-ports.ts`, `win32-ports.test.ts`, fixtures in `src/main/platform/__fixtures__/netstat-tcp.txt`, `netstat-tcpv6.txt`, `tasklist.csv`.

```ts
export interface ListeningSocket { port: number; address: string; pid: number }
/** Rows of `netstat -ano -p TCP|TCPv6` whose foreign address is 0.0.0.0:0 or [::]:0 (listening; the state word is localised). */
export function parseNetstat(text: string): ListeningSocket[];
/** `tasklist /FO CSV /NH` → pid → image name. Quoted CSV, commas inside quotes. */
export function parseTasklist(text: string): Map<number, string>;
/** Group by (port, pid): one entry with every address, sorted by port then pid. */
export function groupSockets(sockets: ListeningSocket[]): { port: number; pid: number; addresses: string[] }[];
```

Tests from fixtures captured on Windows (include `[::1]:5432`, `127.0.0.1:6379`, a port listened on by two PIDs, ESTABLISHED rows that must be ignored, CRLF, header lines, a German-locale `ABHÖREN` row).

### Task 5: Adapter `listListeningPorts` and `describeProcesses`

**Files:** `src/main/platform/adapter.ts`, `win32.ts`, `darwin.ts`, `win32.test.ts`, `win32.integration.test.ts`, `src/main/processes/fake-child.ts`.

1. `PortEntry` becomes `{ port, addresses: string[], pid, processName: string | null }` (command line moves to `describeProcesses`).
2. `listListeningPorts()`: runs both netstat calls and tasklist **in parallel** through `runner.exec` (timeouts 10 s); any non-zero exit → throws INTERNAL "Could not list ports". Unit-tested with `scriptedExec`.
3. `describeProcesses(pids)`: returns `Map<number, string | null>` (command line). Validates PIDs (positive integers, ≤ 64), builds the `-Filter` from numbers only. One PowerShell call, 30 s timeout. Missing PIDs map to null.
4. Darwin: both `notImplemented`.
5. Integration test (Windows only): start `node -e "require('net').createServer().listen(0, function(){ console.log(this.address().port) })"`, read the port, expect it in `listListeningPorts()` with the child's PID (the node PID, spawned directly, not through cmd), and `describeProcesses([pid])` contains `-e`.

### Task 6: Attribution (D3)

**Files:** `src/main/ports/attribution.ts` (+ test).

```ts
/** Walks parent links from pid to the first PID in roots (max 16 hops). */
export function findOwnerRoot(pid: number, parents: ReadonlyMap<number, number>, roots: ReadonlySet<number>): number | null;

export class AttributionCache {
  constructor(deps: { listProcesses(): Promise<ProcessInfo[] | null>; describe(pids: number[]): Promise<Map<number, string | null>> });
  /** Resolves parents and command lines for PIDs not seen before; forgets PIDs no longer listening. */
  refresh(listening: number[], roots: ReadonlySet<number>): Promise<void>;
  ownerRoot(pid: number): number | null;
  command(pid: number): string | null;
}
```

Tests: a three-level chain resolves to the root; a cycle or a 17-level chain gives null; the cache calls `listProcesses` once for two new PIDs and not at all on the next refresh with the same PIDs; a new root (a script started after the first refresh) re-resolves cached PIDs whose owner was null; a PID that stops listening is forgotten; a null process list leaves owners null without throwing.

### Task 7: PortService (D2, D5)

**Files:** `src/main/ports/port-service.ts` (+ test).

```ts
export interface PortServiceDeps {
  platform: Pick<PlatformAdapter, 'listListeningPorts' | 'describeProcesses' | 'listProcesses' | 'killTree'>;
  processes: Pick<ProcessManager, 'list' | 'stop'>;
  ownPid: number;
  now(): number;
  logger: Logger;
}
export class PortService {
  list(): Promise<{ rows: PortRow[]; scannedAt: number; stale: boolean }>;
  kill(input: { pid: number; port: number; confirmed: boolean }): Promise<{ result: 'stopped-script' | 'killed' | 'needs-confirm'; processName: string | null }>;
  /** Resolves when nothing listens on port, or false after timeoutMs. */
  waitUntilFree(port: number, timeoutMs: number): Promise<boolean>;
}
```

Tests (fake platform, fake timers):
- Two `list()` calls within 1 s share one scan; a call after 1 s rescans.
- A failed scan after a good one returns the good rows with `stale: true`; a failed first scan throws INTERNAL.
- Rows owned by a live NestBox process carry `{ projectId, script }`; others null.
- `kill` on an owned port calls `processes.stop(projectId, script)` and never `killTree`.
- `kill` on a foreign port without `confirmed` returns `needs-confirm` and kills nothing; with `confirmed` calls `killTree(pid)`.
- `kill` refuses PID 0, 4 and `ownPid` (FORBIDDEN), and a PID not listening on `port` in a fresh scan (NOT_FOUND).
- Logs `ports kill` with `{ port, owned }` only.

### Task 8: Core channels `ports:list`, `ports:kill`

**Files:** `src/shared/ipc-names.ts`, `src/shared/channels.ts`, `src/shared/ports.ts` (schemas), `src/main/ipc/core-handlers.ts` (+ test), `src/main/index.ts`, `src/shared/client.ts` (+ test).

Schemas: `PortRowSchema`, `PortListSchema`, `PortKillInputSchema = { pid: int > 0, port: 1–65535, confirmed: boolean }`. Handler tests through the router with a fake PortService. Wire `new PortService(...)` in `index.ts`.

### Task 9: Renderer data hooks

**Files:** `src/renderer/lib/ports.ts` (+ test).

- `usePorts({ enabled })`: `useQuery(['ports'], …, { refetchInterval: 3000, refetchIntervalInBackground: false })`.
- `useKillPort()`: mutation; on `needs-confirm` resolves to a value the caller turns into a confirm dialog; on success invalidates `['ports']` and `['processes']`.
- `portsForProject(rows, projectId)`: rows owned by the project or its workspaces (`belongsTo`).

### Task 10: Sidebar entry and Ports page (D1)

**Files:** `src/renderer/state/ui-store.ts` (+ test), `src/renderer/app/Sidebar.tsx` (+ test), `src/renderer/app/App.tsx`, `src/renderer/ports/PortsPage.tsx` (+ test), `src/renderer/ports/KillPortDialog.tsx`.

- UI store: `view: 'project' | 'ports'`, `showPorts()`, and `select(id)` sets `view: 'project'`. `app:navigate` also sets `view: 'project'`.
- Sidebar: a "Ports" button (lucide `plug`) above the sections with the count of NestBox-owned ports; `aria-current="page"` when active.
- Page: filter input, "Only NestBox" switch, "Updated 2 s ago", table with port, addresses, process, PID, owner link (selects the project, opens its Scripts tab with the script), command (truncate, `title` for full), Kill button. Empty state "Nothing is listening". Stale banner.
- Kill: owned → kill directly; foreign → `KillPortDialog` (AlertDialog) → kill with `confirmed: true`. Toasts on errors.
- Tests with the fake bridge: rows render with owners; filter; only-NestBox; owned kill calls `ports:kill` once; foreign kill shows the dialog first; owner link navigates.

### Task 11: Ports Overview card and watch list (D6, D15)

**Files:** `src/renderer/app/PortsCard.tsx` (+ test), `src/renderer/app/OverviewGrid.tsx`.

- Shows the project's own ports (`port · script`), then watched ports as chips: free (muted) or used (`3000 · node.exe` or `3000 · api` when owned), then "PORT 3000 from .env" when the env tool's `facts` method returns a port (Task 16). Polls only while mounted.

### Task 12: `EADDRINUSE` banner (D7)

**Files:** `src/renderer/tools/scripts/addr-in-use.ts` (+ test), `LogPane.tsx` (+ test), `src/renderer/tools/scripts/AddrInUseBanner.tsx`.

```ts
/** The port from the last EADDRINUSE line after the last system "▸" start line, or null. */
export function addrInUsePort(lines: readonly LogLine[]): number | null;
```

Tests: Node's `Error: listen EADDRINUSE: address already in use :::3000`, `0.0.0.0:5173`, `127.0.0.1:8080`, Vite's `Port 5173 is already in use`, NestJS's wrapped message; a line before the last start is ignored; no match → null.

Banner (shown when a port is found and the script is not live): "Port 3000 is in use by node.exe (PID 1234)." with **Kill and restart**. Action: kill (confirm when foreign), `waitUntilFree` through a new `ports:waitFree { port, timeoutMs }` channel (add to Task 8's channels), then `restart` through the scripts tool. If the port never frees: toast "Port 3000 is still in use".

---

## Part C: Env

### Task 13: dotenv parser and writer (D8)

**Files:** `src/main/tools/env/dotenv.ts` (+ test, + `__fixtures__/` corpus).

```ts
type EnvLine =
  | { kind: 'blank' | 'comment' | 'other'; raw: string }
  | { kind: 'entry'; raw: string; key: string; value: string; quote: '' | "'" | '"' | '`'; exported: boolean };
export interface EnvDocument { lines: EnvLine[]; eol: '\n' | '\r\n'; finalNewline: boolean }
export function parseEnv(text: string): EnvDocument;
export function serializeEnv(doc: EnvDocument): string;            // byte-identical round-trip
export function entries(doc: EnvDocument): Map<string, string>;     // last wins
export function duplicateKeys(doc: EnvDocument): string[];
export function setValue(doc: EnvDocument, key: string, value: string): EnvDocument;  // last occurrence
export function addEntry(doc: EnvDocument, key: string, value: string): EnvDocument;
export function removeEntry(doc: EnvDocument, key: string): EnvDocument;              // every occurrence
export function formatValue(value: string, preferred: EnvLine['quote']): { raw: string; quote: EnvLine['quote'] };
```

Tests:
- Round-trip is byte-identical for the corpus: comments, blank lines, `export`, single/double/backtick quotes, `#` inside quotes, inline comments, `KEY=` empty, `KEY` without `=` (kind `other`), multiline double-quoted values, CRLF, no final newline, BOM (kept).
- `entries`: unquoted values trimmed and inline comments stripped; `\n` expanded only in double quotes; last duplicate wins.
- `setValue` keeps the quote style when the new value fits it, otherwise switches to double quotes; keeps `export`; keeps the inline comment; leaves every other line identical (compare line arrays).
- `addEntry` appends after the last entry and before trailing blank lines; in an empty file writes `KEY=value` + eol.
- `removeEntry` removes a multiline entry completely.
- `formatValue`: spaces, `#`, quotes, newlines, leading/trailing whitespace → quoted and escaped; `${VAR}` written verbatim.

### Task 14: Env file access (D10, D12)

**Files:** `src/main/tools/env/env-files.ts` (+ test, uses a temp dir).

```ts
export interface EnvFileAccess {
  read(dir: string, name: string): Promise<{ text: string; version: string }>;
  write(dir: string, name: string, text: string, expectedVersion: string | null): Promise<{ version: string }>;
}
```

- Name must match `^\.env(\..+)?$` and contain no separators → VALIDATION.
- `lstat`: symlink → FORBIDDEN ("Symlinked env files are read-only"); > 1 MiB → VALIDATION.
- `version = ${mtimeMs}:${size}`; mismatch → CONFLICT. `expectedVersion: null` means "must not exist" (create).
- Atomic write: temp file in the same folder, `rename`. Errors never include file contents or values.

### Task 15: Env matrix and profiles (D11, D13)

**Files:** `src/main/tools/env/matrix.ts` (+ test).

```ts
export function buildMatrix(files: { name: string; version: string; doc: EnvDocument; readOnly: boolean }[]): EnvMatrix;
export function profileFiles(names: string[]): string[];  // .env.<name> minus example/backup/*.example
export function activeProfile(envText: string | null, profiles: { name: string; text: string }[]): string | null;
```

Tests: column order (example first, then `.env`, then the rest alphabetically); cell states; missing/undocumented only when both exist; duplicates; profiles exclude `.env.example`, `.env.backup`, `.env.local.example`; active profile by exact bytes; **the serialized matrix contains none of the fixture's values** (`expect(JSON.stringify(m)).not.toContain('s3cr3t')`).

### Task 16: Env tool main half (D9, D14, D15)

**Files:** `src/shared/tools/env/contract.ts` (+ events), `src/shared/tools/index.ts`, `src/main/tools/env/index.ts` (+ test), `src/main/tools/index.ts`, `src/main/index.ts`.

- `createEnvTool({ files: EnvFileAccess, clipboard: { writeText(s): void }, watch: (dir, onChange) => () => void, logger })`.
- Methods: `matrix`, `reveal`, `copy`, `setValue`, `addKey`, `removeKey`, `switchProfile`, `facts` (returns `{ port: number | null }`, used by the Ports card).
- `switchProfile`: read `.env` (may be absent), write `.env.backup` (create or overwrite, no version check), write `.env` with `expectedVersion = envVersion`.
- After each `matrix` read, publish `env.facts` (`{ port, urls: keyNames }`).
- `activate`: start the folder watcher (debounced 200 ms) → `emit('changed')`. `dispose`: stop watchers.
- Tests: every method against a temp folder; `copy` writes the fake clipboard and returns nothing; `reveal` of an absent key → NOT_FOUND without the key's value in the message; edits keep other lines; a stale version → CONFLICT; a write emits `changed`; **the memory logger's entries contain no values**; `appliesTo` is always true.

### Task 17: Env panel (renderer)

**Files:** `src/renderer/tools/env/` (`Panel.tsx`, `EnvTable.tsx`, `ValueCell.tsx`, `EditValueDialog.tsx`, `Profiles.tsx`, `use-env.ts`, `OverviewCard.tsx`, `index.ts`) + tests; `registry.ts`, `icons.ts` (lucide `key-round`).

- `useEnvMatrix(projectId)` refetches on the `changed` event (`useToolEvent`).
- Cell: masked dot string; Reveal shows the value in place until blur or 30 s (local state only, never in the query cache); Copy calls `copy` and toasts "Copied"; Edit opens a dialog (textarea for multiline), saving with the version; CONFLICT → toast and refetch.
- Absent cell: "Add" (value input, "Copy from example" when the example cell is set: calls `reveal` on the example then fills the input).
- Row menu: "Remove from <file>" with an AlertDialog.
- Flags: badges and a "Flagged only" filter. Profiles bar with "Switch to…" (AlertDialog; extra warning when no profile is active).
- Tests: masked by default; reveal shows one value only and hides it on blur; copy never puts the value in the DOM; edit sends the version; conflict path; switch profile confirm text.

---

## Part D: End to end and docs

### Task 18: e2e

**Files:** `e2e/fixtures/npm-app/package.json` (`"web": "node web.js"`), `e2e/fixtures/npm-app/web.js` (HTTP server on port 0 that prints `port <n>` and writes `web.port`), `e2e/fixtures/npm-app/.env`, `.env.example`, `e2e/ports.spec.ts`, `e2e/env.spec.ts`.

- Ports: start `web`, read `web.port`, open Ports, the row for that port shows `nestbox-e2e-app · web`; Kill stops the script (Scripts tab shows stopped) and the port disappears.
- Env: open Env, the matrix shows `PORT` missing from `.env`, add it with "Copy from example", check the file on disk ends with the new line and kept its comment line.

### Task 19: Docs and verification

- `CLAUDE.md`: folder structure (`ports/`), core channels added in M2, the env value rules, the gotchas found during M2.
- `HANDOFF.md`: state, M3 follow-ups.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; Xvfb smoke of the Ports page (darwin stub → "Port listing isn't available on this platform yet") and the env panel.
- Request a code review of the branch; fix findings; open the PR as a draft with a manual checklist for Windows.
