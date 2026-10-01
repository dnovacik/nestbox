# Nestbox M1 (Scripts and logs): Design Notes

Date: 2026-10-01
Status: Draft, awaiting the owner's approval
Source of truth: `docs/nestbox-spec.md`. These notes cover only the spec's gaps for M1, plus the M0 review follow-ups listed in `docs/superpowers/HANDOFF.md`. They build on `2026-10-01-nestbox-m0-design.md` and don't restate it.

## Scope

M1 delivers the roadmap's "Scripts + logs" row:

- Run, stop and restart `package.json` scripts, for root projects and workspace packages. Stop kills the whole process tree.
- Auto-restart on crash, with a backoff and a crash counter.
- Run groups.
- A log viewer with plain (ANSI) and structured JSON modes, search, `file:line` links, export, and a split view for two panes.
- A tray icon showing the worst process state, a tray menu, crash notifications, close to tray, and a confirmed quit that stops everything.
- Orphan cleanup on the next start after a crash.
- A small Settings dialog.
- Store migration v1 → v2, the first real one.
- Playwright end-to-end tests.
- Every M1 item from the M0 review follow-ups.

**Not in M1:** the port list and `EADDRINUSE` "kill and restart" (M2), stdin or interactive input to scripts, the command palette ("run a script by name" waits for M3), Claude Code entries in the tray (M3), and macOS `spawnScript`/`killTree` (still stubs until the v2 macOS phase).

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Where process state lives. The spec lists ProcessManager as a core service, but the tray, sidebar dots, status bar and "Stop all" all need it across projects. | **`ProcessManager` is a core service** in `src/main/processes/`. The Scripts tool is a thin layer over it. The shell reads process state through new **core** channels (`processes:list`, `processes:stopAll`) and the `processes:changed` event. Tools still never touch `channels.ts`. |
| 2 | When "starting" becomes "running" | **Owner's choice: after the process has been alive for 3 s.** A crash inside those 3 s goes straight from starting to crashed. |
| 3 | Orphans left by a Nestbox crash | **Owner's choice: ask, then kill.** Each tracked process is recorded with its PID and OS start time. On the next start, survivors whose PID and start time both still match are listed in a native dialog ("Stop them" / "Leave running"). A reused PID is never touched. |
| 4 | Where settings are changed | **Owner's choice: a small Settings dialog** behind a gear in the title bar. It holds close to tray, tray icon theme, log buffer size and editor command. Auto-restart is a per-script toggle in the Scripts panel. |
| 5 | Run groups in a monorepo ("API + web + worker" are usually different packages) | **Run groups live on the root project, and each entry names a package**: `{ relPath, script }`, where `''` is the root. Migration v2 converts the old `string[]` to this form. |
| 6 | Tool access to services and settings | **`ToolContext` gains `settings`** (`get()` and `update(fn)`) for the tool's slice of the root project's `toolSettings`, validated by the tool's `settingsSchema`. Tools that need core services are built by factories (`createScriptsTool(deps)`), so `mainTools` becomes `createMainTools(deps)`. |
| 7 | Tool events to the renderer | **Tools declare event payload schemas** next to their contract (`defineEvents({...})`), registered in `toolEvents`. The renderer's `useToolEvent(toolId, projectId, event, cb)` validates each payload before using it. |
| 8 | Stdin | **None.** stdin is `ignore`. Nestbox isn't a terminal, and "Open terminal here" covers interactive work. |
| 9 | Exit classification | A user stop gives `stopped`. Exit code 0 without a stop gives `exited`. Anything else gives `crashed`, with the exit code and the last stderr line, or the last line if stderr is empty. On Windows a `taskkill /F` exit code is never read as a crash, because stops set the state first. |
| 10 | Logs across restarts | **One buffer per script, kept across restarts.** System lines mark each start (`▸ pnpm run dev`) and each exit (`■ exited with code 1`). "Clear" empties it. A changed `logBufferLines` applies the next time a buffer is created. |
| 11 | Which logs are sent to the renderer | **All of them, batched every 50 ms.** The renderer keeps lines only for mounted panes. A pane loads a snapshot on mount and resyncs by sequence number if it sees a gap. Nothing needs a subscribe/unsubscribe protocol. |
| 12 | ANSI rendering under a strict CSP with token-only colours | **Our own small SGR parser** that turns text into styled segments, with no `innerHTML`. The 16 standard colours map to `--ansi-*` tokens in `globals.css`. 256-colour and truecolor use inline `rgb()` styles, not hex. Bold, dim, italic, underline, inverse and reset are supported. Other escape sequences (cursor movement, OSC) are stripped. |
| 13 | Exporting "the visible lines" | **The renderer sends the sequence numbers of the visible lines** (or `'all'`). Main writes those lines from its buffer as plain text with ANSI stripped, to a path from a native save dialog. Log text never travels renderer → main. |
| 14 | Quitting with processes running | **Every quit path asks once if Nestbox processes are running**: tray Quit, closing the window with `closeToTray` off, and `Ctrl+Q`. An OS shutdown (`session-end`) doesn't ask. |
| 15 | Removing a project that has running processes | The Remove confirm dialog says how many will be stopped. Remove stops them, including its workspaces' processes, then removes the project. |

## Process manager

`src/main/processes/process-manager.ts`, with no Electron imports, tested against a fake adapter and against real `node` child processes through a test-only adapter.

```ts
type ProcessState = 'starting' | 'running' | 'stopping' | 'stopped' | 'exited' | 'crashed';

type ProcessSummary = {
  projectId: string;            // root id or workspace id
  script: string;
  state: ProcessState;
  pid: number | null;
  startedAt: number | null;     // epoch ms
  exit: { code: number | null; signal: string | null; lastLine: string | null } | null;
  crashCount: number;           // consecutive crashes; reset after 60 s of healthy running
  autoRestart: boolean;
  nextRestartAt: number | null; // while waiting out the backoff
};
```

- **Key.** `(projectId, script)`. One live instance per key. `start` on a live key throws `CONFLICT`.
- **Spawn.** `platform.spawnScript({ cwd, packageManager, script, env })`. The environment is `resolveShellEnv()` plus `FORCE_COLOR=1`. `.env` files are never read: the scripts load their own. A null package manager falls back to `npm`.
- **Windows `spawnScript`.** It runs `cmd.exe /d /s /c "<pm> run <script>"` through `cmdInvocation` with `windowsVerbatimArguments`, `windowsHide: true` and `stdio: ['ignore', 'pipe', 'pipe']`. Script names go through `assertCmdSafe`, so a name containing `"` is a `VALIDATION` error. The PID that gets recorded is the `cmd.exe` root.
- **Windows `killTree`.** It runs `taskkill /PID <pid> /T /F` and awaits its exit. "Process not found" (exit 128) counts as success. This needs a new `CommandRunner.exec(file, args) → { code, stdout }`, which also serves the editor pre-check and the start-time lookup.
- **New adapter method `processStartTime(pid)`** returns epoch ms or `null`. On Windows it runs `powershell -NoProfile -Command (Get-Process -Id <pid>).StartTime.ToFileTimeUtc()`. It runs once per spawn and once per recorded PID at startup, never in a loop.
- **States.** `starting` turns into `running` after 3 s. Stop sets `stopping`, kills the tree, and then gives `stopped`. If the tree is still alive after 5 s, it logs a system line and gives `stopped` anyway.
- **Auto-restart.** It's per script and off by default. The backoff is 1, 2, 4, 8 and 16 s, then capped at 30 s. After 5 consecutive crashes it gives up and stays `crashed` with "gave up after 5 crashes". 60 s of healthy running resets the counter. A user stop cancels a pending restart.
- **Events.** It emits `changed` (throttled to 100 ms → `processes:changed`), `crashed` (feeds notifications and the tray), and `lines` (feeds the log pipeline).
- **Shutdown.** `stopAll()` kills every tree in parallel and awaits them all. It is part of the graceful quit.

**PID ledger.** `src/main/processes/pid-ledger.ts` keeps `processes.json` in `userData`, separate from the settings store, because it changes on every start and stop. Each entry is `{ pid, startTime, projectId, script }`, with no command line and no environment. The file is rewritten atomically (temp file plus rename) on every spawn and exit, and removed after a clean quit.

## Logs

- **Lines.** Each line is `{ seq, ts, stream: 'stdout' | 'stderr' | 'system', text }`. `seq` increases per buffer, and it keeps increasing after a clear, so a resync works.
- **Splitting.** Output is split on `\r?\n`. A lone `\r` (a progress bar) keeps only the text after it. A partial last line is held back for up to 50 ms, then flushed. Lines longer than 8 KiB are truncated with `…`. Decoding is UTF-8 with a streaming decoder, so multibyte characters split across chunks stay intact.
- **Ring buffer.** `src/main/processes/ring-buffer.ts`, with capacity `logBufferLines`. Lines live in memory only.
- **Batching.** A `LogBatcher` collects lines per key and flushes every 50 ms as the scripts tool event `logs` (`{ script, lines }`) over `tools:event`.
- **Shared context.** The Scripts tool publishes `scripts.processes` (`[{ script, pid, state }]`) per project. The M2 port manager will read it.

## Scripts tool

`src/shared/tools/scripts/contract.ts`, `src/main/tools/scripts/`, `src/renderer/tools/scripts/`.

- **Applies to** any project whose `package.json` has at least one script, or a root project with workspaces.
- **Settings slice** (on the root project): `{ autoRestart: { relPath, script }[] }`.

| Method | Input | Output |
| --- | --- | --- |
| `list` | `{}` | the scripts (`name`, `command`) for this project, plus run groups when it's a root |
| `start` / `stop` / `restart` | `{ script }` | `ProcessSummary` |
| `setAutoRestart` | `{ script, enabled }` | `ProcessSummary \| null` |
| `getLogs` | `{ script, afterSeq? }` | `{ lines, firstSeq, lastSeq }` |
| `clearLogs` | `{ script }` | nothing |
| `exportLogs` | `{ script, seqs: number[] (max 100 000) \| 'all' }` | `{ saved: boolean }` |
| `openFileAt` | `{ path, line, column? }` | nothing |
| `saveRunGroup` / `deleteRunGroup` / `startRunGroup` / `stopRunGroup` | `{ name, entries? }` / `{ name }` | the run groups, or `ProcessSummary[]` |

- **`openFileAt`** accepts only paths taken from log text. A relative path resolves against the process's `cwd`. The file must exist and be a regular file. It calls `openInEditor(path, line)`, so it goes through the existing escaping.
- **`exportLogs`** uses a new `dialogs.saveFile(defaultName)` service that main injects into the tool factory.

## Log viewer (renderer)

- **Layout.** The Scripts panel has a script list on the left: name, command in muted mono, a state badge, start/stop/restart, the auto-restart toggle and the crash count. A crashed row shows the exit code and its last line. Run groups sit above the list, with start and stop per group and a dialog to create or edit one (on a root, it lists scripts from the root and every workspace). Log panes are on the right. Clicking a script shows it in the active pane. "Split" adds a second pane, and each pane has its own script picker.
- **Virtualisation.** `@tanstack/react-virtual` with `measureElement`, because an expanded JSON row is taller than the others. Lines don't wrap and the pane scrolls horizontally. "Follow" stays on while the pane is scrolled to the bottom, and scrolling up pauses it.
- **Per-line mode.** A line that parses as a JSON object with recognised fields renders as a structured row. Every other line renders as ANSI plain text. The parser is a pure function in `src/renderer/tools/scripts/structured.ts` and handles:
  - **pino:** numeric `level` (10–60), `time`, `msg`, `context`, `reqId` or `req.id`
  - **NestJS JSON logger:** string `level` (`log` becomes `info`), `timestamp`, `message`, `context`

  Both normalise to `{ level, time, context, message, requestId, raw }`.
- **Filters.** Level is multi-select. Context is a pick-list of the contexts seen so far. `requestId` is a text match. While any of these is set, plain lines are hidden.
- **Search.** It covers all visible lines (plain text with ANSI stripped, or the structured message plus raw JSON). Matches are highlighted, with next and previous.
- **Links.** `file:line[:col]` links are detected in plain text and in structured messages: absolute Windows paths, relative paths with a known source extension, and `file:///` URLs. A click calls `openFileAt`.
- **Toolbar.** Search, the filters, Follow, Clear and Export (which sends the visible sequence numbers).
- **Overview card.** It lists the project's processes with their states, and links to the Scripts tab.

## Tray, window and quit

- **Tray.** `src/main/tray/`. A pure function `trayState(processes)` gives the worst state, in this order: `crashed`, `starting`, `running`, `idle`. Another pure function, `buildTrayMenu(model)`, returns the menu template. Both are unit-tested. A thin `TrayController` wires them to Electron.
- **Icon.** It's built from `png/tray/tray-<theme>-<state>-16.png`, with the 32 px file added as the `scaleFactor: 2` representation. The theme comes from `trayIconTheme`, where `auto` uses `nativeTheme.shouldUseDarkColors`. The tooltip reads "Nestbox: 2 running" (or "1 crashed").
- **Menu.**
  - One submenu for each project that has processes, listing each process with Stop, Restart and Show logs.
  - A "Run groups" submenu.
  - "Open in VS Code" for each project.
  - Show Nestbox, then Quit.
  - Show logs opens the window and sends a new `app:navigate` event (`{ projectId, tab: 'scripts', script }`).
- **Clearing crashed.** A crashed process stays crashed until the user restarts it or stops it, which clears it to `stopped`. Until then the tray stays red.
- **Notifications.** A native notification fires on each crash: "api crashed in shop-backend (exit 1)". It never includes log text. Clicking it does the same as Show logs. When auto-restart is on, only giving up triggers a notification.
- **Close to tray.** If `closeToTray` is on, `close` hides the window. Otherwise the window closes and the quit flow runs. `window-all-closed` no longer quits by itself.
- **Graceful quit.** This replaces M0's fire-and-forget dispose:
  1. In `before-quit`, call `preventDefault`.
  2. Confirm if processes are running (decision 14).
  3. Await `Promise.allSettled([processes.stopAll(), toolHost.disposeAll()])`, raced against 5 s. Log any tool that didn't finish, by id.
  4. Clear the ledger.
  5. Set the guard flag and call `app.quit()`.

## Startup and orphans

- **Window first.** The window is created before detection runs. `ProjectService.init()` no longer awaits detection: `list()` already detects lazily per project. Init steps use `Promise.allSettled`, so one failure doesn't block the others.
- **Orphan check.** Once the window is shown, the ledger is read. Each recorded entry is compared with `processStartTime(pid)`, and the survivors are offered in a native message box. "Stop them" calls `killTree` on each. Either way, the ledger is then cleared.

## Settings and store

- **Migration v1 → v2.**
  - Adds `settings.trayIconTheme` (default `'dark-taskbar'`).
  - Converts `projects[].runGroups[].scripts: string[]` to `entries: { relPath: '', script }[]`.
  - Gets a fixture test from a real v1 file.
- **New core channels.** `settings:get` returns `AppSettings & { readOnly: boolean }`. `settings:update` takes a strict partial with these rules:
  - `editorCommand` is 1–260 characters and must not contain `"`, CR, LF or NUL.
  - `logBufferLines` is between 1 000 and 1 000 000.
  - `trayIconTheme` and `closeToTray` are also accepted.
- **Store service.** It gains `updateSettings(fn)`.
- **Read-only store** (follow-up):
  - **Newer schema version:** a store with a newer `schemaVersion` is no longer backed up and reset. Nestbox runs read-only, using the file's data where it parses and defaults otherwise.
  - **Failed default write:** if writing the defaults fails, or the write right after a backup fails, the store goes read-only and logs a warning instead of throwing.
  - **Wording:** the log message on a failed backup becomes "Store unavailable, running read-only". It no longer says "Store reset".
  - **UI:** while read-only, the status bar shows a "Settings are read-only" warning, and saving settings returns `INTERNAL` with that message.
- **Settings dialog.** It contains:
  - close to tray (switch)
  - tray icon theme (select)
  - log buffer lines (number)
  - editor command (text, with a hint that the change applies on the next "Open in VS Code")

## M0 review follow-ups folded in

| Follow-up | Where it lands |
| --- | --- |
| Window before detection, lazy detect, `allSettled` | "Startup and orphans" |
| Invalidate `['tool']` on `projects:changed` | The `useProjectsChangedSubscription` hook also invalidates `['tools']` and `['tool']` |
| Graceful quit | "Tray, window and quit" |
| Missing editor | `openInEditor` first runs `where <editor>` through `exec`. If that fails, it returns `NOT_FOUND`: "Editor command "code" was not found on PATH. Change it in Settings." The editor name is a setting, not a payload. |
| Store writes, misleading wording, read-only on a newer schema | "Settings and store" |
| `isTrustedSender` throws → fail closed | The router catches it and returns `FORBIDDEN` |
| Bound `tools:invoke` input | The router rejects payloads whose JSON is longer than 2 MiB with `VALIDATION`, before parsing |
| `web-contents-created` hardening | `app.on('web-contents-created')` applies `hardenWebContents` to every `webContents`, not just the main window |
| Tool errors exclude input values | A tool-host test throws from a handler and asserts that the input is absent from the envelope and from the logger |
| "All projects" count ignores the filter, no "no matches" hint | The count shows filtered of total ("3 of 12"), plus a "No projects match" row |
| Project info card has no skeleton or error state | A skeleton while loading, and an inline error with Retry |
| ToolTabs accessibility | `role="tablist"`/`tab`/`tabpanel`, `aria-controls`/`aria-labelledby`, roving `tabIndex`, and Left/Right/Home/End keys |
| Test gaps | Tests for: the pending state, the stale-selection fallback, rename/pin/refresh/open mutation hooks, add when detect throws, and the title bar workspace display |

## IPC additions

| Channel | Input | Output |
| --- | --- | --- |
| `processes:list` | none | `ProcessSummary[]` |
| `processes:stopAll` | `{ projectId? }`: one project and its workspaces, or every process | nothing |
| `settings:get` | none | `AppSettings & { readOnly }` |
| `settings:update` | strict partial (see above) | `AppSettings & { readOnly }` |

**New events:** `processes:changed` (no payload) and `app:navigate` (`{ projectId, tab, script? }`, validated in the renderer).

## Shell UI

- **Sidebar dots.** Each row shows the worst state of its own processes. A collapsed root also counts its workspaces' processes. The colours are green for running, amber for starting or stopping, red for crashed, and grey otherwise.
- **Status bar.** It shows "N running" (starting plus running, across all projects), and the read-only warning when it applies.
- **Project header.** A "Stop all" button appears when the project, or one of its workspaces, has live processes. It doesn't ask for confirmation, because it only stops Nestbox's own processes.
- **Title bar.** A gear opens the Settings dialog.

## Testing

- **Unit, node project:**
  - ring buffer
  - line splitter (CR, partial lines, multibyte characters split across chunks, truncation)
  - log batcher (fake timers)
  - process manager (states, 3 s promotion, stop vs crash, backoff schedule, give-up, counter reset, `stopAll`, `CONFLICT`)
  - PID ledger (atomic write, a corrupt file reads as empty)
  - orphan matching
  - Windows `spawnScript`, `killTree`, `processStartTime` and the editor pre-check, by exact command line
  - `trayState` and `buildTrayMenu`
  - migration v1 → v2
  - read-only store paths
  - router size limit and throwing sender check
  - the scripts tool's handlers
  - `exportLogs` writing selected lines without ANSI
  - `openFileAt` path rules
- **Integration, node project:** the process manager runs real `node -e` children through a test-only adapter, on every CI OS. A Windows-only test spawns `cmd.exe` through `win32.spawnScript` and kills it with `killTree`.
- **Renderer, jsdom:**
  - the SGR parser
  - the structured-line parser (pino and NestJS fixtures)
  - link detection
  - the Scripts panel (start, crash row, auto-restart toggle, run group dialog)
  - the log pane (snapshot plus events, gap resync, filters hiding plain lines, search, follow)
  - the Settings dialog
  - sidebar dots, status bar count, Stop all
  - every UI follow-up above
- **End-to-end (Playwright `_electron`), in `e2e/`.** The tests launch the built app with an isolated user-data folder (`NESTBOX_USER_DATA_DIR`, honoured only when `!app.isPackaged`). They stub `dialog.showOpenDialog` from the main process to add a fixture project with an `npm` lockfile. They then:
  - start a script that prints and stays alive
  - read its log line
  - stop it
  - check that the PID is gone
  - check that a crashing script shows the crashed state
- **CI.** A new `e2e` job runs on windows-latest only, because `spawnScript` is stubbed on macOS. It downloads the Electron binary, runs `pnpm build`, then `pnpm e2e`. The existing matrix job is unchanged. This Linux container can't run the Windows end-to-end tests, so they're verified in CI.

**Manual verification before M1 is done** (on Windows): run `pnpm dev` in a real monorepo. Start API + web as a run group, crash one, check the tray turns red and a notification appears, restart it, split the logs, filter JSON by level, click a stack-trace link, close to tray, then quit from the tray and check that no `node.exe` survives in Task Manager.

## Delivery

- **Branch.** M1 is built on a worktree branch cut from `m0-skeleton`, as M0 was built from `main`.
- **Plan.** Next is the plan at `docs/superpowers/plans/2026-10-01-nestbox-m1-scripts-logs.md`. It will have bite-sized TDD tasks in roughly this order:
  1. the follow-ups that touch the core (router, store, startup)
  2. migration v2 and settings channels
  3. adapter `exec`, `spawnScript`, `killTree` and `processStartTime`
  4. ring buffer, splitter and batcher
  5. the process manager and the ledger
  6. core process channels and shell UI
  7. the scripts tool, main half
  8. the log viewer
  9. the Scripts panel and run groups
  10. tray, notifications, close to tray and graceful quit
  11. the Settings dialog
  12. the UI follow-ups
  13. Playwright end-to-end tests and the CI job
  14. CLAUDE.md and handoff updates
