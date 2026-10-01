# Nestbox M0 (Skeleton): Design Notes

Date: 2026-10-01
Status: Approved 2026-10-01 (with changes 13–15, bootstrap, and decision 12 settled)
Source of truth: `docs/nestbox-spec.md`. These notes only cover the spec's gaps for M0. They don't restate it, and they don't reopen the decisions it records.
Visual reference: `docs/design/DESIGN-NOTES.md` and `docs/design/prototype.tsx`. The prototype governs look only; where it disagrees with the spec, the spec wins.

## Scope

M0 delivers the roadmap's "Skeleton" row and the definition of done from the kickoff brief:

- The app launches on Windows with `pnpm dev` and shows the shell, the sidebar and an empty state.
- Projects can be added (folder picker), removed and renamed. They persist in electron-store, validated with Zod, with a `schemaVersion`.
- Project detection.
- Typed, validated IPC through `window.nestbox`.
- The tool module interfaces and a registry, plus one real tool ("Project info").
- A `PlatformAdapter` with a Windows implementation and a macOS stub.
- CI on windows-latest and macos-latest running lint, typecheck and unit tests.
- A `CLAUDE.md` in the repo root.

**Not in M0:** tray icon and `trayIconTheme` (M1), the "Stop all" header button (M1), the status bar's process and port counts (M1/M2), the header's Claude Code button and the command palette with its title-bar search button (M3), drag-and-drop add, tags, Playwright end-to-end tests (from M1), event batching (M1, when there are log streams), framework detection (M3), settings UI, a light theme.

## Decisions made during brainstorming

| # | Gap in spec | Decision |
| --- | --- | --- |
| 1 | `channels.ts` is supposed to define every channel, yet adding a tool should never touch the core | **Per-tool contracts.** `channels.ts` defines the core channels plus one generic `tools:invoke` channel. Each tool declares its methods' Zod input and output schemas in `src/shared/tools/<id>/contract.ts`. |
| 2 | How workspace sub-projects behave | **Nested and derived.** They are detected live, shown nested under their parent and selectable, and are not persisted. ID = `<rootId>::<relative posix path>`. |
| 3 | What the placeholder tool is | **"Project info" tool, kept permanently.** It renders the `DetectedProject` facts through `tools:invoke` and doubles as the reference "how to write a tool" example. |
| 4 | How much of the adapter is real in M0 | **Real on Windows:** `openInEditor`, `openTerminal` (`wt -d`, falling back to `cmd /K`), `resolveShellEnv`, `normalizePath`/`samePath`. **Stubbed until their milestone:** `listListeningPorts`, `killTree`, `spawnScript`. Stubs throw `NotImplementedError`. |
| 5 | Where `schemaVersion` lives | At the root of the store: `{ schemaVersion, settings: AppSettings, projects: Project[] }`. It is removed from `AppSettings`. |
| 6 | Tool icon format | `ToolDefinition.icon` is a lucide icon name. |
| 7 | The prototype has an "Overview" tab with cards; the spec has `RendererTool.OverviewCard` | **Overview is a shell tab, not a tool.** It is always the first tab and renders a grid of the `OverviewCard`s from each applicable tool. In M0 the Project info tool provides a card (package manager, workspaces, env files, Claude Code files) and its own full Panel. |
| 8 | DESIGN-NOTES puts brand assets in `resources/brand/`, but the files are in `docs/resources/brand/` | **Move them to `resources/brand/` at the repo root**, which is electron-vite's `resources/` convention and the `extraResources` source. `docs/design/` stays as reference material. |
| 9 | Only dark design tokens exist, yet `AppSettings.theme` allows light | **M0 is dark only.** The tokens are CSS variables in the Tailwind theme, so adding a light palette later is one block. `theme` is stored but not acted on yet. |
| 10 | The sidebar design has a pinned section | **Pin is included**: one `projects:setPinned` channel, using the field that already exists. It's cheap, and the layout depends on it. Tags still wait for later. |
| 11 | The title bar shows the git branch | **Detection reads the current branch** from `.git/HEAD`, following the `gitdir:` pointer for worktrees. No git binary is called. The branch is null for a detached HEAD, which shows the short hash instead. |
| 12 | DESIGN-NOTES says macOS tray icons must not be template images; the spec said template image | **Settled by the user: macOS tray icons are not template images.** macOS uses the same coloured-hole PNGs and picks the theme through `nativeTheme`. The spec's platform table is updated to match. |
| 13 | Paths in commands | **Every Windows adapter command escapes its arguments correctly.** That covers `code`, `wt` and `cmd`, each run through the shell or `cmd.exe`, so `cmd` metacharacters and `wt`'s `;` separator must be neutralised. See "Argument escaping" below. |
| 14 | Path casing | **Paths are stored and displayed with their original casing.** `normalizePath` is used only inside `samePath` and duplicate detection. Nothing derived from it is persisted or shown. |
| 15 | Fonts | **Inter and JetBrains Mono are bundled locally through `@fontsource`.** There are no network requests, and the system stacks remain the fallback. |

## Refinements to the spec's interfaces

The spec types `MainTool.handlers` as `Record<string, (ctx, input: unknown) => Promise<unknown>>`. M0 keeps the same shape but derives the types from the tool's contract:

```ts
// shared/tools/contract.ts
export type ToolMethod = { input: z.ZodType; output: z.ZodType };
export type ToolContract = Record<string, ToolMethod>;
export const defineContract = <C extends ToolContract>(c: C) => c;

// main/tools/types.ts
export type ToolHandlers<C extends ToolContract> = {
  [K in keyof C]: (ctx: ToolContext, input: z.infer<C[K]['input']>) => Promise<z.infer<C[K]['output']>>;
};
export interface MainTool<S, C extends ToolContract> extends ToolDefinition<S> {
  contract: C;
  handlers: ToolHandlers<C>;
  activate?(ctx: ToolContext): void;
  dispose?(): Promise<void>;
}
```

- `src/shared/tools/index.ts` holds a `toolContracts` map from tool id to contract. That map plus `main/tools/index.ts` and `renderer/tools/index.ts` are the tool registry: adding a tool appends one line to each.
- The renderer calls `nestbox.tools.invoke('project-info', projectId, 'getFacts', {})`, and the output type is inferred from `toolContracts`.
- The preload never sees the contracts. It only forwards the generic channel.
- `ToolContext.shared` is backed by an in-memory `SharedContext` service keyed by `projectId`. M0 implements it and tests it, but no tool publishes anything yet.

`PlatformAdapter` gains two methods that M0 needs, because comparing paths is OS-specific:

```ts
normalizePath(p: string): string;          // comparison key only: resolved, trailing separator stripped, lower-cased on win32
samePath(a: string, b: string): boolean;   // normalizePath(a) === normalizePath(b)
```

The value from `normalizePath` is never stored, displayed or passed to a command. Stored `Project.path` is `path.resolve(picked)` with its original casing kept.

## IPC

**Core channels** (all request/response, all Zod-validated on input in main):

| Channel | Input | Output |
| --- | --- | --- |
| `dialog:pickFolder` | none | `string \| null` |
| `projects:list` | none | `ProjectSummary[]`: stored fields plus `missing` and nested `workspaces` |
| `projects:add` | `{ path }` | `ProjectSummary` |
| `projects:remove` | `{ id }` | nothing |
| `projects:rename` | `{ id, name }` (trimmed, 1–100 chars) | `ProjectSummary` |
| `projects:setPinned` | `{ id, pinned }` | `ProjectSummary` |
| `projects:refresh` | `{ id }` | `ProjectSummary` (re-runs detection) |
| `app:getInfo` | none | `{ version }` from `app.getVersion()`, shown in the title bar |
| `projects:openInEditor` | `{ id }` | nothing |
| `projects:openTerminal` | `{ id }` | nothing |
| `tools:list` | `{ projectId }` | `{ id, name, icon }[]` for the tools whose `appliesTo` is true |
| `tools:invoke` | `{ toolId, projectId, method, input }` | the method's output |

**Events** (main to renderer): `projects:changed`. The preload exposes `nestbox.on(event, cb)`, which returns an unsubscribe function, and only whitelisted event names are accepted. Batching arrives with log streams in M1.

**Error envelope.** The router never throws across IPC. Every handler returns `{ ok: true, data } | { ok: false, error: { code, message } }`, and the preload unwraps it, throwing a `NestboxError` with the same `code`.

- Codes: `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `NOT_IMPLEMENTED`, `INTERNAL`.
- `CONFLICT` covers a duplicate path. `NOT_IMPLEMENTED` covers a call to a stubbed adapter method.
- Error messages never include payload values.

**Router guards.**

- The sender frame's URL must be the app's own origin, either the dev server or `file://` for the packaged renderer.
- Unknown channels, unknown tool ids and unknown methods are rejected.
- Tool output is validated against the contract before it is returned, so a buggy tool can't leak extra fields.

**Logging rule.** The app's logger records the channel name, the tool and method, the duration and the error code. It never records payloads. This is how "never log env values" holds once tools exist.

## Project detection

`detectProject(path): Promise<DetectedProject>` is a pure function over the filesystem with no Electron imports. It is tested against fixture folders in temp directories.

```ts
type DetectedProject = {
  id: string; rootId: string; path: string; relPath: string;   // '' for root
  name: string;                  // stored name > package.json name > folder basename
  missing: boolean;              // folder no longer exists
  packageJson: { name?: string; scripts: Record<string, string> } | null;
  packageManager: 'pnpm' | 'yarn' | 'npm' | 'bun' | null;
  envFiles: string[];            // file names only, never opened
  workspaces: DetectedProject[]; // only on roots
  prismaSchema: string | null;   // relative path
  dockerCompose: string | null;  // relative path
  git: { branch: string | null; head: string | null } | null; // null = not a git repo; head = short hash
  buildOutput: 'dist' | 'build' | null;
  claude: { claudeMd: boolean; claudeLocalMd: boolean; claudeDir: boolean; mcpJson: boolean };
};
```

**Package manager**

- Detected from the lockfile: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm, `bun.lockb` or `bun.lock` → bun.
- If there are several lockfiles, the first in that order wins.
- Sub-projects inherit the root's package manager.

**Env files**

- Matches every file whose name starts with `.env`: `.env`, `.env.local`, `.env.example`, and so on.
- Only names are recorded. The detector never opens these files.

**Workspaces**

- Read from `pnpm-workspace.yaml` (`packages:`) or from the `workspaces` field in `package.json`, in either its array or `{ packages }` form.
- Globs are expanded, and `!` negations are honoured.
- `node_modules` is ignored.
- Only folders that contain a `package.json` count.

**Other files**

- Prisma: `prisma/schema.prisma`, or a `prisma/schema/` folder.
- Compose: `docker-compose.yml`, `docker-compose.yaml`, `compose.yml` or `compose.yaml`.
- Git: `.git` can be a folder or a file, since worktrees use a file. The branch comes from `HEAD` (`ref: refs/heads/<branch>`). A detached HEAD gives a null branch and a 7-character hash. Nothing reads beyond `HEAD`.

**Failure handling.** A malformed `package.json` or YAML file doesn't fail detection. The field becomes `null`, and the error is logged by file name only.

**Caching.** Detection runs on add, on refresh and on app start. The result is cached in memory in main and is never persisted.

## Persistence

`StoreService` wraps electron-store behind a small `KeyValueBackend` interface, so tests use an in-memory backend.

**Startup sequence**

1. Load the raw store.
2. Run migrations up to `CURRENT_SCHEMA_VERSION` (1 in M0). The migration table starts empty, but the runner is tested with a fake v0 → v1 migration.
3. Validate with Zod.
4. If validation fails, copy the file to `config.corrupt-<timestamp>.json`, start from defaults and log a warning. Values are never logged.

**What's stored.** Only the `Project` and `AppSettings` fields from the spec. A project's `id` is a random UUID. The `name` defaults to `package.json` name, then the folder basename. Rename overwrites `name`.

**Rules on add and remove**

- Adding a path that `samePath` matches against an existing project is rejected with `CONFLICT`.
- A folder that goes missing stays in the list, marked `missing`.

## Platform adapter (Windows, M0)

- **`openInEditor(path, line?)`** spawns `settings.editorCommand` (default `code`) through the shell, passing `-g path:line` when a line is given.
- **`openTerminal(cwd, command?)`** tries `wt -d <cwd>`, running `[command]` if given. If `wt` isn't found, it falls back to `cmd /K`.
- **`resolveShellEnv()`** returns `process.env` on Windows.
- **Testability.** Every Windows method runs commands through an injected `CommandRunner`, so the unit tests assert on the exact command line and run on both CI runners.

**Argument escaping**

Everything lives in `src/main/platform/win32-escape.ts` and is unit tested.

- **Through `cmd.exe`.** `code` is a `.cmd` shim, and the `cmd /K` fallback goes through `cmd.exe` too. Each argument is quoted with the MSVCRT rules: wrap it in `"`, double any backslashes in front of a `"`, escape inner `"`. Then every `cmd` metacharacter (`^ & | < > ( ) % ! "`) gets a `^` in front. The final string is spawned with `windowsVerbatimArguments: true`, so Node doesn't quote it a second time.
- **`wt`.** Spawned directly (`wt.exe`, no shell) with an argument array. `wt` splits its own command line on `;`, so every `;` inside a path or command is escaped as `\;`. The `-d` directory is passed as a single quoted argument.
- **Required test cases.** Paths containing spaces, `&`, `^`, `%`, `;` and `"`-adjacent backslashes, plus a trailing backslash (`C:\a b\`), for each of `openInEditor`, `openTerminal` through `wt`, and `openTerminal` through the `cmd /K` fallback. The tests assert on the exact command line produced. One Windows-only integration test (skipped on other OSes) runs `cmd /c echo` through the escaper and checks that the argument comes back unchanged.
- **macOS.** `darwin.ts` implements `normalizePath` and `samePath` (case-sensitive, which is an acceptable approximation for the stub) and throws `NotImplementedError` for everything else.
- **Selection.** `platform/index.ts` is the only file that reads `process.platform`. ESLint enforces this with `no-restricted-properties`, which has an override for `src/main/platform/**`.

## Security

- `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- The preload is bundled by electron-vite, so it has no runtime `require` beyond `electron`.
- Navigation is blocked: `will-navigate` is prevented unless the target is the app's origin, and `setWindowOpenHandler` denies new windows.
- `session.setPermissionRequestHandler` denies everything.
- **CSP.** Packaged builds get a strict policy: `default-src 'self'`, no `unsafe-eval`, no remote origins. The dev build relaxes it only as far as Vite HMR requires, and only when `!app.isPackaged`. The exact directives are pinned in the plan once current electron-vite behaviour has been checked.
- A single-instance lock makes a second launch focus the existing window.

## Renderer

The layout follows the prototype, minus everything DESIGN-NOTES lists under "Do not copy" and minus anything that belongs to a later milestone.

**Window and title bar**

- Frameless window with `titleBarStyle: 'hidden'` and `titleBarOverlay`, so Windows draws its own native controls in the card colour. There are no traffic lights.
- The 40 px title bar is a drag region. Left: the mark and "nestbox", with the real version from `app:getInfo` beside them. Centre: the selected project's name and git branch.
- The command palette search button isn't in M0.

**Sidebar (256 px)**

- A filter input that filters by name on the client.
- A "Pinned" section, shown only when something is pinned.
- An "All projects" section with a count.
- Workspaces nested under their parent, collapsible.
- An "Add project" button fixed at the bottom.
- Each row has a status dot. It is grey in M0, because there are no processes yet.

**Project header**

- The name, plus a "missing" badge when the folder is gone.
- A metadata row in mono: the path (in Windows form on Windows), the package manager badge, the branch, and the short hash.
- Action buttons: "Open in VS Code" and "Open terminal here".
- An overflow menu with Refresh, Pin/Unpin, Rename and Remove. Rename and Remove aren't offered for workspaces.

**Tabs**

- "Overview" comes first, then one tab per applicable tool (lucide icon plus name).
- The active tab gets an accent underline.
- Panels are lazy-loaded.

**Status bar (28 px)**

- M0 shows the project count and nothing invented.
- Process count (M1), port count (M2) and the palette hint, `Ctrl+K` on Windows and `⌘K` on macOS (M3), arrive with their milestones.

**Empty state**

With no projects, the main area shows the lockup mark, one line of copy and the "Add project" button.

**Feedback**

- shadcn `Sonner` toasts for errors, such as `CONFLICT` when the project is already added.
- An `AlertDialog` confirms Remove.
- Rename uses an inline input: Enter saves, Escape cancels.

**State**

- TanStack Query handles IPC calls, and `projects:changed` invalidates the `projects` query.
- Zustand holds the selected project id, the active tab per project, the sidebar filter and the collapsed workspace groups.

**Visual design**

- **Tokens.** The DESIGN-NOTES tokens become CSS variables in the Tailwind theme (`--color-bg`, `card`, `surface`, `hover`, `border`, `text`, `text-muted`, `text-faint`, `accent`, `accent-hover`, `status-green`, `status-amber`, `status-red`, `status-grey`) and are mapped onto shadcn's variables.
- **No hex in components.** No hex literal appears anywhere in `src/renderer/**` except the theme CSS. An ESLint `no-restricted-syntax` rule catches hex literals in TSX string literals.
- **Flat.** No glow, no backdrop blur, no pulsing dots. Overlays are solid. Badges have a tinted background with a border.
- **One accent.** `#7C8CFF`, with no purple. Claude elements use the accent or neutral text.
- **Fonts.** Inter (sans) and JetBrains Mono (mono) are bundled locally through `@fontsource` packages imported in the renderer entry. The fallbacks are `"Segoe UI", system-ui, sans-serif` and `"Cascadia Mono", ui-monospace, monospace`. There are no network requests, so the CSP `font-src 'self'` is enough.
- **The mark.** `resources/brand/svg/nestbox-mark.svg` is imported as a React component through `vite-plugin-svgr` and recoloured through props, never redrawn. The prototype's inline logo is not reused.

**Brand assets in main**

- `src/main/assets.ts` is the single asset loader. In development it resolves `resources/brand` from the app root; packaged, it resolves it from `process.resourcesPath`.
- M0 uses it for the `BrowserWindow` icon (`png/nestbox.ico`).
- `electron-builder.yml` lists `resources/brand` in `extraResources` and points `win.icon` at it. Building the installer still waits for M3.

## Repository bootstrap

- **First commit, on `main`.** The commit contains `LICENSE` (MIT, with the author from the git config), `.gitignore` (Node, Electron, `out/`, `dist/`, `release/`, `.env*` except `.env.example`), `.editorconfig` (LF, UTF-8, 2 spaces, final newline), a stub `README.md` (name, one-line pitch, "work in progress", MIT), the existing `docs/` and these design notes.
- **`.gitattributes`.** Includes `* text=auto eol=lf` so the Windows and macOS CI runners agree on line endings.
- **M0 work.** Happens on a worktree branch, `m0-skeleton`.

## Carried forward to later milestones (from DESIGN-NOTES)

**M1**

- **Tray wiring.** 16 px image plus a 32 px `scaleFactor: 2` representation.
- **Tray state.** The worst state across processes: crashed, then starting, then running, then idle.
- **New setting.** `trayIconTheme: 'auto' | 'dark-taskbar' | 'light-taskbar'`, defaulting to `dark-taskbar`. It's added through store migration v1 → v2.
- **"Stop all" header button.** Stops only processes Nestbox started.
- **Logs.** One log pane per script, with a split view for two.
- **Script states.** An amber "starting" state, and a crashed state that shows the error.

**M2**

- **Port kills.** Confirm only for processes Nestbox didn't start.
- **No "free all ports".**
- **Env values.** Revealed one at a time, never all at once.
- **Env table.** A matrix of every `.env*` file, not just `.env` against `.env.example`.

**M3**

- **Static server toggles.** Also no-cache and simulated latency.
- **Static server port.** The default port must not clash with the dev server.
- **Claude Code tab.** The context-generator diff with Apply, plus read-only lists. There is no "Sync MCP" button.
- **Command palette shortcut.** `Ctrl+K` on Windows, `⌘K` on macOS.
- **Lockup.** Convert the lockup's wordmark to outlines before the README uses it.

## Testing

**Vitest** runs as two projects:

- `node` covers main and shared: detection, store and migrations, router validation and error envelope, tool registry and the `tools:invoke` dispatch, `SharedContext`, Windows adapter argument building, path helpers, contract type tests (`expectTypeOf`).
- `jsdom` covers the renderer: the empty state, the add flow against a mocked `window.nestbox` (including the conflict toast), rename and remove interactions, the sidebar filter and pinned section, and the Overview grid rendering the `OverviewCard`s of applicable tools.
- The `node` project also covers the asset loader's dev and packaged path resolution and the git `HEAD` parsing (branch, detached head, worktree `gitdir:`).

**CI** (GitHub Actions, matrix windows-latest and macos-latest) runs `pnpm install --frozen-lockfile`, then `lint`, `typecheck` and `test`.

**Manual verification** before M0 is called done: `pnpm dev` on Windows, then add a real monorepo, check the nested workspaces and the Project info facts, rename, remove, restart the app and confirm the projects persisted.
