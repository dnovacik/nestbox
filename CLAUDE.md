# NestBox

Electron + React desktop toolbox for Node/TypeScript projects. Windows first, macOS later (no Linux).
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
| `pnpm e2e` | Playwright end-to-end tests against the built app (run `pnpm build` first; needs the Electron binary; scripts only run on Windows, so CI runs it on windows-latest) |
| `pnpm format` | Prettier |

## Folder structure

```text
src/main/        Electron main. index.ts is the only file wiring real Electron objects.
  platform/      PlatformAdapter (win32 real, darwin stub). The ONLY place allowed to read process.platform.
  detection/     detectProject(): pure filesystem detection, no Electron imports
  store/         StoreService over electron-store (Zod + schemaVersion + migrations)
  projects/      ProjectService (add/remove/rename/pin/refresh, workspace lookup, run groups, tool settings)
  processes/     ProcessManager (spawn, states, crash/auto-restart, per-script log ring buffers), PID ledger
  lifecycle/     quit controller (close to tray, confirmed graceful quit), orphan prompt
  tray/          tray menu model (pure), tray controller, crash notification text
  ipc/           router (validates every payload), register, core-handlers
  tools/         tool host, shared context, main halves of tools (scripts/ is built by a factory)
  security/      CSP, origin checks, webContents/session hardening
src/preload/     window.nestbox bridge (whitelisted channels, returns envelopes)
e2e/             Playwright Electron tests and fixture projects
src/shared/      Zod schemas, channel contract, typed client, tool contracts
src/renderer/    React app: app/ (shell), tools/ (panels), components/ (ui = shadcn), lib/, state/
resources/brand/ Brand assets (packaged as extraResources → brand/)
```

## Conventions

- pnpm only. TypeScript strict with `noUncheckedIndexedAccess`; no `any`.
- Conventional commits, small and frequent.
- TDD: write the failing Vitest test first. Tests sit next to the source (`foo.ts` → `foo.test.ts`).
- Security: `contextIsolation` on, `nodeIntegration` off, sandboxed renderer, strict CSP (a meta tag in builds, a header in dev), whitelisted IPC, and the sender origin checked on every call.
- No `process.platform` outside `src/main/platform/`. Lint enforces this.
- Never store or log env values or project file contents. `Logger` fields are primitives only; log channel, tool, method, file names and codes.
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
- **Payload limit.** The router rejects payloads whose JSON is over 2 MiB before parsing.
- **Logs flow one way.** Log text only goes main → renderer (`tools:event` batches every 50 ms). Export sends seq numbers, never text.

## Adding a tool

1. `src/shared/tools/<id>/contract.ts`: a `ToolDefinition` (id, name, lucide icon name, `appliesTo`, `settingsSchema`) and a `defineContract({...})` with Zod input/output per method.
2. Register it in `src/shared/tools/index.ts` (`toolContracts`, `toolDefinitions`).
3. `src/main/tools/<id>/index.ts`: `defineMainTool({ ...definition, contract, handlers })`. Handlers get a `ToolContext` (`project`, `shared`, `emit`, `platform`, `settings`). `ctx.settings.get()/update(fn)` reads and writes the tool's slice of the root project's `toolSettings`, validated by `settingsSchema` (give every field a default). A tool that needs core services is a factory (see `createScriptsTool(deps)`), wired in `createMainTools` in `src/main/tools/index.ts`.
4. Events: declare payload schemas with `defineEvents({...})` next to the contract and register them in `toolEvents`. The renderer listens with `useToolEvent(toolId, projectId, event, cb)`, which drops payloads that fail the schema.
5. `src/renderer/tools/<id>/`: a lazy `Panel`, an optional `OverviewCard`, and a data hook that calls `api.tools.invoke(id, projectId, method, input)`. Register it in `src/renderer/tools/registry.ts` (`fullHeight: true` for a panel that scrolls itself), and add its icon to `src/renderer/tools/icons.ts`.
6. You never need to edit `channels.ts`, the router or the shell. The reference implementations are `project-info` (minimal) and `scripts` (factory, settings, events).

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
- **Processes.** Only `ProcessManager` spawns or kills scripts, always through the adapter (`spawnScript` runs `cmd.exe /d /s /c "<pm> run <script>"`; `killTree` runs `taskkill /T /F`). A user stop is never a crash, even though taskkill makes the root exit 1. Every PID is recorded with its spawn time in `userData/processes.json`; the orphan prompt only offers processes whose OS start time is within 3 s of it.
- **Single-instance lock.** Spawned scripts inherit Electron's lock handle on Windows, so after NestBox is killed its orphans keep the lock. A launch that doesn't get the lock reads `userData/instance.json` (pid + start time) and starts anyway when that instance is gone, retrying the lock after the orphan prompt (`lifecycle/instance-record.ts`).
- **Quitting.** Every exit goes through the quit controller (`lifecycle/quit-controller.ts`): confirm when scripts run, stop them and dispose tools within 5 s, then quit. `window-all-closed` deliberately does nothing.
- **react-virtual in jsdom.** It sizes the viewport from `offsetWidth`/`offsetHeight`, which jsdom reports as 0, so tests that render a `LogPane` give `HTMLElement.prototype` a layout size (see `LogPane.test.tsx`). `initialRect` does not help.
- **End-to-end.** `NESTBOX_USER_DATA_DIR` gives the app an isolated profile, and is honoured only when unpackaged. The tests stub `dialog.showOpenDialog`/`showMessageBox` from the main process. The empty state and the sidebar both have an "Add project" button: scope locators.
- **shadcn registry.** `ui.shadcn.com` can be blocked by a sandbox's network policy. `dialog.tsx`, `switch.tsx` and `select.tsx` were then written by hand in the new-york style; regenerate them with the CLI when it is reachable.
