# NestBox

Electron + React desktop toolbox for Node/TypeScript projects. Windows and macOS (macOS is a preview since v1.1.0; no Linux, though dev and e2e run there with the macOS adapter).
Source of truth: `docs/nestbox-spec.md`. Milestone designs and plans: `docs/superpowers/`. Visual reference: `docs/design/DESIGN-NOTES.md` (the prototype is look-only; the spec wins).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app with HMR (electron-vite) |
| `pnpm build` | Build main, preload and renderer into `out/` |
| `pnpm lint` | ESLint (includes the `process.platform` and hex-colour rules) |
| `pnpm typecheck` | `tsc` for the node and web projects |
| `pnpm test` | Vitest: `node` project (main/shared/preload) + `renderer` project (jsdom) |
| `pnpm vitest run --project renderer` | Renderer tests only |
| `pnpm e2e` | Playwright end-to-end tests against the built app (run `pnpm build` first; needs the Electron binary). CI runs them on windows-latest and macos-latest; on Linux use `xvfb-run` (the ports spec is skipped there) |
| `pnpm format` | Prettier (rewrites the whole repo, which isn't Prettier-clean: run `pnpm prettier --write <files>` on your own files instead) |
| `node scripts/screenshots.mjs` | README screenshots from the built app with demo projects (`xvfb-run` on Linux) |
| `node scripts/outline-wordmark.mjs` | Regenerates `nestbox-lockup-outlined.svg` from the lockup with the bundled Inter |

## Folder structure

```text
src/main/        Electron main. index.ts is the only file wiring real Electron objects (app-menu.ts is the pure macOS menu template).
  platform/      PlatformAdapter (win32, darwin; Linux gets darwin for development). The ONLY place allowed to read process.platform.
  detection/     detectProject(): pure filesystem detection, no Electron imports
  store/         StoreService over electron-store (Zod + schemaVersion + migrations)
  projects/      ProjectService (add/remove/rename/pin/refresh, workspace lookup, run groups, tool settings)
  processes/     ProcessManager (spawn, states, crash/auto-restart, per-script log ring buffers), PID ledger
  ports/         PortService (machine-wide listening ports, attribution to scripts, kill rules)
  lifecycle/     quit controller (close to tray, confirmed graceful quit), orphan prompt
  tray/          tray menu model (pure), tray controller, crash notification text
  ipc/           router (validates every payload), register, core-handlers
  tools/         tool host, shared context, BatchedLog, main halves of tools (scripts/, env/, static/, claude/ are factories)
  fs/            versioned-file: read/write with a version token (CONFLICT when stale), atomic, size cap, no symlink writes
  security/      CSP, origin checks, webContents/session hardening
src/preload/     window.nestbox bridge (whitelisted channels, returns envelopes)
e2e/             Playwright Electron tests and fixture projects
src/shared/      Zod schemas, channel contract, typed client, tool contracts
src/renderer/    React app: app/ (shell, CommandPalette), ports/ (Ports page), tools/ (panels), components/ (ui = shadcn, log/ = LogView), lib/, state/
scripts/         One-off Node scripts (screenshots, wordmark outlines)
resources/brand/ Brand assets (packaged as extraResources → brand/)
```

## Conventions

- pnpm only. TypeScript strict with `noUncheckedIndexedAccess`; no `any`.
- Conventional commits, small and frequent.
- TDD: write the failing Vitest test first. Tests sit next to the source (`foo.ts` → `foo.test.ts`).
- Security: `contextIsolation` on, `nodeIntegration` off, sandboxed renderer, strict CSP (a meta tag in builds, a header in dev), whitelisted IPC, and the sender origin checked on every call.
- No `process.platform` outside `src/main/platform/`. Lint enforces this.
- Never store or log env values or project file contents. Env values reach the renderer only through the env tool's `reveal` (one value) and travel back only in an edit the user typed; `copy` writes the clipboard from main. The env matrix carries presence (set/empty/absent), never values. `Logger` fields are primitives only; log channel, tool, method, file names and codes.
- Paths are stored and displayed in their original casing. `normalizePath` is for comparison only (`samePath`, duplicate detection).
- Arguments passed through cmd.exe go through `cmdInvocation`/`escapeCmdArg`; `wt.exe` is spawned directly (Node quoting) with `;` escaped via `escapeWtArg`; the folder for the cmd fallback travels only as `cwd`.
- Renderer colours come from tokens in `src/renderer/styles/globals.css` only. Lint rejects hex literals elsewhere. Dark theme only for now; one accent (`brand`); flat (no glow or blur).
- Fonts are bundled through `@fontsource-variable/*`. No network calls.
- Renderer packages are devDependencies (Vite bundles them). `dependencies` holds only what main requires at runtime.

## IPC

- **Core channels.** Defined in `src/shared/channels.ts`, one Zod input/output schema per channel. Names are in `src/shared/ipc-names.ts`, which has no Zod dependency and is safe for the preload.
- **Envelopes.** Main returns `{ ok, data } | { ok: false, error: { code, message } }`. The preload passes it through unchanged, because `contextBridge` drops custom `Error` fields. `createNestboxClient` (`src/shared/client.ts`) unwraps it and throws `NestboxError` with the code.
- **Error codes:** `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `NOT_IMPLEMENTED`, `FORBIDDEN`, `INTERNAL`. Messages never contain payload values (tool/method ids may appear in NOT_FOUND messages).
- **Core channels added in M1:** `settings:get`/`settings:update` (the Settings dialog; `readOnly` when the store can't be saved), `processes:list`/`processes:stopAll` (the shell: sidebar dots, status bar, Stop all). Events: `processes:changed` (throttled, no payload) and `app:navigate` (`{ projectId, tab, script? }`, tray and notifications).
- **Core channels added in M2:** `ports:list` (cached 1 s in main; the renderer polls every 3 s only while the Ports page or a Ports card is mounted), `ports:kill` (`{ pid, port, confirmed }`: a NestBox-owned port stops its script; anything else answers `needs-confirm` until confirmed; System and NestBox itself are FORBIDDEN), `ports:waitFree`.
- **Core channel added in M3:** `app:openExternal` (`{ url }`, http/https only, otherwise VALIDATION): Markdown links and "Open in browser".
- **Event added in v1.1:** `app:openSettings` (no payload): the macOS menu's Settings… (`⌘,`).
- **Payload limit.** The router rejects payloads whose JSON is over 2 MiB before parsing.
- **Logs flow one way.** Log text only goes main → renderer (`tools:event` batches every 50 ms). Export sends seq numbers, never text.

## Adding a tool

1. `src/shared/tools/<id>/contract.ts`: a `ToolDefinition` (id, name, lucide icon name, `appliesTo`, `settingsSchema`) and a `defineContract({...})` with Zod input/output per method.
2. Register it in `src/shared/tools/index.ts` (`toolContracts`, `toolDefinitions`).
3. `src/main/tools/<id>/index.ts`: `defineMainTool({ ...definition, contract, handlers })`. Handlers get a `ToolContext` (`project`, `shared`, `emit`, `platform`, `settings`). `ctx.settings.get()/update(fn)` reads and writes the tool's slice of the root project's `toolSettings`, validated by `settingsSchema` (give every field a default). A tool that needs core services is a factory (see `createScriptsTool(deps)`), wired in `createMainTools` in `src/main/tools/index.ts`.
4. Events: declare payload schemas with `defineEvents({...})` next to the contract and register them in `toolEvents`. The renderer listens with `useToolEvent(toolId, projectId, event, cb)`, which drops payloads that fail the schema.
5. `src/renderer/tools/<id>/`: a lazy `Panel`, an optional `OverviewCard`, and a data hook that calls `api.tools.invoke(id, projectId, method, input)`. Register it in `src/renderer/tools/registry.ts` (`fullHeight: true` for a panel that scrolls itself: its root needs `h-full min-h-0` plus its own `overflow-y-auto`, because the tab panel is not a flex container and hides overflow; `flex-1` alone grows past the window). The tab panel gives every tab its 24 px inset (`p-6`), so a panel root adds no outer padding (`e2e/panel-layout.spec.ts` checks both), and add its icon to `src/renderer/tools/icons.ts`.
6. A tool that keeps its own log (requests, prompt output) uses `BatchedLog` in main (ring buffer + 50 ms `logs` event, `getLogs`/`clearLogs` methods) and a `LogSource` in the renderer passed to `LogView` (see `staticLogSource`).
7. You never need to edit `channels.ts`, the router or the shell. The reference implementations are `project-info` (minimal), `scripts` (factory, settings, events) and `static` (own log).

## Gotchas

- **Dependency bundling.** electron-store is ESM-only, so it is bundled into the CommonJS main through `externalizeDeps.exclude`. The preload is fully bundled (`externalizeDeps: false`) because sandboxed preloads cannot `require` files.
- **Versions.** electron-vite 5 supports Vite ≤ 7, and typescript-eslint requires TypeScript < 6.1. Check both before bumping either.
- **pnpm.** Build scripts run only for packages listed in `pnpm.onlyBuiltDependencies`.
- **shadcn.** Generated components in `src/renderer/components/ui/` are excluded from lint. The style is `new-york` (Radix, `asChild`). Don't let the CLI rewrite `globals.css`.
- **Workspace ids.** A workspace package's id is `<rootId>::<relPath>`. Workspaces are derived live and never stored.
- Electron 44 ships no install script and electron-vite reads node_modules/electron/path.txt directly, so the root `postinstall` runs `node node_modules/electron/install.js` (needs network once; skipped when ELECTRON_SKIP_BINARY_DOWNLOAD is set, because install.js itself ignores that variable). CI sets ELECTRON_SKIP_BINARY_DOWNLOAD=1. If `pnpm dev` says "Electron uninstall", run that command. `onlyBuiltDependencies` matters for esbuild.
- The shadcn CLI (4.21) may import `cn` from an npm package called "cn" — always rewrite to `@/lib/utils` and do not add that package. It also puts `radix-ui` under dependencies; move it to devDependencies.
- `cmdInvocation`/`assertCmdSafe` reject `"`, CR, LF and NUL (a `.cmd` shim re-parses `%*`, so quotes cannot be escaped safely). Only pass paths and Nestbox-built tokens.
- Packaged builds trust only the exact renderer entry file URL as the IPC/navigation origin (`isAppUrl`); dev trusts only the dev-server origin.
- Tests must wait for data with `findBy*`; never change product markup (e.g. swap landmarks) to satisfy test timing.
- **Processes.** Only `ProcessManager` spawns or kills scripts, always through the adapter (`spawnScript` runs `cmd.exe /d /s /c "<pm> run <script>"`; `killTree` runs `taskkill /T /F`). A user stop is never a crash, even though taskkill makes the root exit 1. Every root PID is recorded with its spawn time in `userData/processes.json`. At startup the orphan check lists all processes once (`listProcesses`, one PowerShell call) and offers a root whose start time is within 3 s of it, or, when the root `cmd.exe` has exited, the children it left behind (they still name it as their parent).
- **Quitting.** Every exit goes through the quit controller (`lifecycle/quit-controller.ts`): confirm when scripts run, stop them and dispose tools within 5 s, then quit. `window-all-closed` deliberately does nothing.
- **react-virtual in jsdom.** It sizes the viewport from `offsetWidth`/`offsetHeight`, which jsdom reports as 0, so tests that render a `LogPane` give `HTMLElement.prototype` a layout size (see `LogPane.test.tsx`). `initialRect` does not help.
- **End-to-end.** On Windows, `app.process()` is a launcher: the real main process is its child. Use `app.evaluate(() => process.pid)` to kill the app's main process. `NESTBOX_USER_DATA_DIR` gives the app an isolated profile, and is honoured only when unpackaged. The tests stub `dialog.showOpenDialog`/`showMessageBox` from the main process. The empty state and the sidebar both have an "Add project" button: scope locators.
- **Ports.** Ports are a core service, not a tool (they're machine-wide): the sidebar's "Ports" entry sets `view: 'ports'` in the UI store. Attribution walks the parent chain from the listening PID to a live script root using `listProcesses` (PowerShell), fetched only when an unseen PID starts listening. `describeProcesses` reads command lines (UI only, never logged). netstat's state column is localised, so a listening row is recognised by its `0.0.0.0:0`/`[::]:0` foreign address.
- **Env tool.** `.env` edits go through `tools/env/dotenv.ts`, which keeps untouched lines byte-identical. Versions are `ino:mtimeNs:size` (atomic writes change the inode); a stale version is CONFLICT. The tool watches a package folder from its first `matrix` call (the tool host never calls `activate`). `watchedPorts` came with a Zod default, so the store stayed at v2.
- **Command output.** `CommandRunner.exec` caps stdout at 64 KiB unless the call passes `maxBytes` (netstat and tasklist do). Fixtures under `src/main/platform/__fixtures__/` are `-text` in `.gitattributes` so their CRLF bytes survive.
- **shadcn registry.** `ui.shadcn.com` can be blocked by a sandbox's network policy. `dialog.tsx`, `switch.tsx` and `select.tsx` were then written by hand in the new-york style; regenerate them with the CLI when it is reachable.
- **Platform commands.** `spawnCommand({ cwd, command, args, env, stdin })` runs a NestBox-built command line like `spawnScript`, with free text only on stdin (the Claude quick prompt). `execCommand(command, args, { cwd, timeoutMs, maxBytes? })` runs one to completion (`claude --version`, `git check-ignore`). Both go through `cmdInvocation`. cmd.exe looks in the current folder (the project) before PATH, so on Windows `execCommand` sets `NoDefaultCurrentDirectoryInExePath` and `spawnCommand` resolves the program from PATH/PATHEXT first (`win32-resolve.ts`, relative PATH entries skipped). `openTerminal` rejects `%` in the command.
- **Static tool.** One server per package (`toolSettings.static.servers[relPath]`), localhost unless "Share on LAN". `isHiddenPath` runs before sirv because sirv's dev mode serves dotfiles despite `dotfiles: false`. Logged paths drop the query string. The HTTPS certificate is one per machine in `userData/static-cert.json`, renewed within 30 days of expiry or for a new LAN IP; the key is never logged.
- **Claude tool.** `claude-files.ts` never reads MCP args, env or URL paths into results. `CLAUDE.md`/`CLAUDE.local.md` use `fs/versioned-file` and keep the file's line endings. The context block lives between `<!-- nestbox:start -->` and `<!-- nestbox:end -->`; env contributes `PORT` (a number) and `.env.example` key names only. Raw HTML in the Markdown preview is shown as text (a remark step), images show their alt text, and only http(s) links open.
- **Git tool.** Read-only, never fetches. One `git --no-optional-locks status --porcelain=v2 --branch -z` (2 MiB cap through `execCommand`'s `maxBytes`; a full buffer means "N+") and one `cat-file commit <oid>`, never a `--format=%…` (cmd.exe would expand `%`). `--no-optional-locks` keeps git from rewriting the index, so a refresh never wakes the `.git` watch (gitdir plus `<commondir>/refs` recursively, `*.lock` ignored, 300 ms quiet, at most 1/s). The renderer also refetches on window `focus`, which is how working-tree edits show up. Only folders with their own `.git` get the tool (`p.git !== null`). The project header shows the branch from the same status query (falling back to detection). File names, subjects and authors are shown, never logged.
- **Database tool.** The URL value is read in main (`.env`, then `prisma/.env`; the variable is the schema's `env("…")`, else `DATABASE_URL`) and only `describeUrl`'s output (provider, host, port, database, SQLite file) leaves it: never the user, password or query. Reachability is a TCP connect (3 s), no credentials. Test login is `prisma db execute --stdin` with `SELECT 1`; only the P-code is mapped to NestBox's message (Prisma's text can name the user). Prisma runs through the package manager with `--no-install` (never downloads) and only when `node_modules/prisma` resolves from the package; `migrate dev` opens a terminal; Studio gets a free port from 5555 and is killed on dispose. `prisma.config.ts` is never executed.
- **TODOs tool.** The file list is `git ls-files -z --cached --others --exclude-standard` (cwd = the package, 8 MiB cap), else a tinyglobby walk that skips dependency/build folders and applies the root `.gitignore` with `ignore`. A tag counts only right after a comment marker (`match.ts`). Limits: 20,000 files, 5,000 matches, 30 s, files over 1 MiB or with a NUL in the first 8 KiB skipped, and so is any file whose real path (symlinks resolved) leaves the package. Results live in memory only (TODO text is file content: shown, never logged or stored); the renderer starts the first scan of a session when `results` is null, then only Refresh scans. Tags are a root-project setting. Paths from the renderer go through `fs/inside.ts` (`resolveInside`), shared with the git tool.
- **Health tool.** Checks live in `toolSettings.health.packages[relPath]` (at most 20; URLs with a user or password are refused). An env check stores only the key: main reads the value from the package's `.env` and requests its origin plus the check's path; labels show `KEY · host:port/path`. A package is live while a script of it (or, for a root, of its workspace packages) runs: first run 2 s later, then every `intervalSec`. GET, headers only, no redirects, 5 s; TLS is verified except for loopback. Notifications fire only on ok→fail within one live session. Logs carry ids, states and codes, never URLs. The status query uses `staleTime: 0`, because results change while no card or panel listens.
- **Compose tool.** Every command is `docker compose -f <detected file> …` with `cwd` = the package, run through `spawnCommand` (it needs stderr: `execCommand` has none). Service names must be in the current `config --services` list. From `ps --all --format json` (a JSON array or JSON lines, by Compose version) only service, state, health, exit code and publishers are kept; commands, labels and Docker's error text never leave `parse.ts`/`errors.ts` (stderr is only classified, e.g. daemon-down). One action at a time per package (CONFLICT), 10-minute timeout, output in the Actions log; one followed service (`logs -f --no-log-prefix --tail 500`), unfollowed when the panel unmounts. Down never passes `-v`. The end-to-end specs put `e2e/fixtures/fake-docker` first on `PATH` (`launch(project, { pathPrepend })`); it keeps state in `.fake-docker.json` in the project.
- **Mock API tool.** Routes live in `toolSettings.mock.packages[relPath]` (at most 100); `RouteSchema` validates paths, headers (reserved ones refused, no CR/LF) and JSON bodies with `{{params.x}}`/`{{query.x}}` filled by `shared/tools/mock/template.ts` (shared with the editor). One `node:http` server per package on 127.0.0.1, started by the user; the handler reads the in-memory config that every edit refreshes, so edits apply without a restart. A non-local `Host` gets 403 (DNS rebinding), request bodies are drained up to 1 MiB (413 past it) and never kept, and the request log drops the query string. `firstFreePort`/`isPortFree` live in `tools/net.ts` (shared with Static).
- **Inspector tool.** A `node:http` proxy per package on 127.0.0.1 (first free port from 4020) forwarding to `toolSettings.inspector.packages[relPath].target` (local addresses only, `LocalUrlSchema`) or `http://localhost:<PORT from .env>`. Non-local `Host` gets 403, hop-by-hop headers are dropped, `x-forwarded-*` added; 502 (unreachable, with the code), 504 (no headers in 30 s), 413 (body over 10 MiB), 501 (WebSocket upgrade). Entries (last 200, bodies capped at 256 KiB, `record.ts`) live in memory only; `sideView` masks secret headers (`isMasked`) and `reveal` returns one value. Replay/send go straight to the target (`sendRequest`); a send's `{ name, keep: true }` header takes the recorded value in main. `copyCurl` writes the clipboard from main. The tab bar scrolls sideways when the tools don't fit (`ToolTabs`, wheel → horizontal, no scrollbar).
- **Command palette.** `paletteEntries` is pure (actions are data). cmdk matches the label and keywords through a custom filter: item values are ids holding random project ids, whose letters would otherwise match searches. Ctrl+K with Shift is ignored (Playwright's `Control+K` sends Shift: press `Control+k`).
- **Release.** Tag `v<version>` (matching `package.json`) and push, or run the workflow on `main`: `.github/workflows/release.yml` checks the version, builds `NestBox-Setup-<version>.exe` (Windows) and `NestBox-<version>-{arm64,x64}.dmg` (macOS, ad-hoc signed, `identity: '-'`) as artifacts, then one job attaches them all to a draft GitHub Release (publishing it creates the tag). CI's `package` job builds `--dir` on both OSes and runs `e2e/packaged.spec.ts` against `win-unpacked/NestBox.exe` or `mac-arm64/NestBox.app/Contents/MacOS/NestBox` (that spec skips unless `NESTBOX_PACKAGED_EXE` is set). The packaged app ignores `NESTBOX_USER_DATA_DIR`.
- **Screenshots.** `scripts/screenshots.mjs` fakes processes, ports and the claude CLI by wrapping main's handlers through `ipcMain._invokeHandlers` (Electron internals; fine for a dev script, never in the app). Run `pnpm build` first: it uses `out/`.
- **macOS adapter.** `darwin.ts` uses absolute system tools (`/usr/sbin/lsof`, `/bin/ps` with `LC_ALL=C`, `/usr/bin/open`). Scripts and commands are spawned directly (no shell) with `newProcessGroup` (POSIX `detached`, never on Windows: it opens a console). `killTree` (`posix-kill.ts`) sends SIGTERM to the group and to descendants that left it, waits up to 3 s, then SIGKILL; EPERM is FORBIDDEN. Start times come from `ps etime` (1 s precision). Ports come from `lsof -F pcftn`; without root only the user's own sockets are listed (the Ports page says so). PID 1 is protected like Windows' 0 and 4.
- **Login-shell env (macOS).** Apps started from Finder get a minimal PATH, so `posix-shell.ts` runs `$SHELL -ilc` with **two different markers** around `env -0` (shells set `$_` to the previous command's last argument, so the env itself contains the start marker). Cached 5 minutes; falls back to `process.env`; values never logged. `commandExists`/`execCommand` resolve commands on that PATH without a subprocess.
- **Terminals.** The `terminalApp` setting (`TERMINAL_APPS`; the dialog offers `TERMINALS_BY_PLATFORM[platform]`). Windows: `cmd` skips `wt`. macOS: no AppleScript; a folder opens with `open -a <App> <cwd>`, a command through a self-deleting `.command` file (`commandFileScript`, folder single-quoted, commands limited to plain words by `assertTerminalCommand`); Ghostty gets `--working-directory` and `-e`. Auto = iTerm2 when installed, else Terminal.
- **macOS app shell.** `appMenuTemplate` (Edit roles so ⌘C/⌘V work; Quit through the quit controller); `activate` shows the window; the title bar pads 78 px for the traffic lights; `useModKey()` shows ⌘; the tray icon always follows the system appearance (`auto`, the theme setting is hidden) and a click opens its menu only.
- **Zombies in containers.** Some Linux containers' PID 1 never reaps orphans, so a killed grandchild stays a zombie and `kill(pid, 0)` still succeeds. Integration tests check `ps -o stat=` instead; on macOS launchd reaps at once.
