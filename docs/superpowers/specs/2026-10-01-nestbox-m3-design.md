# NestBox M3 (Static server and ship): Design Notes

Date: 2026-10-01
Status: Approved 2026-10-01
Source of truth: `docs/nestbox-spec.md`. These notes cover only the spec's gaps for M3, plus the M3 follow-ups listed in `docs/superpowers/HANDOFF.md`. They build on the M0–M2 design notes and don't restate them.

## Scope

M3 delivers the roadmap's "Static + ship" row, the last v1 milestone:

- **Static server tool**: serve a folder (default: the build output) with SPA fallback, LAN URL and QR code, optional HTTPS with a self-signed certificate, CORS/no-cache/latency toggles, and a request log in the log viewer.
- **Claude Code tool**: `claude` status, `CLAUDE.md`/`CLAUDE.local.md` preview and editing, `.claude/` contents, `.mcp.json` servers, gitignore warnings, Open/Continue in a terminal, a headless quick prompt, and the "Project runtime" context generator.
- **Command palette** (`Ctrl+K`): projects, tools, scripts, run groups, Claude entries, Ports, Settings.
- **Shipping**: an NSIS installer built by GitHub Actions on release tags, a packaged-app smoke test in CI, the README (screenshots, architecture, "how to write a tool"), and the lockup wordmark converted to outlines.
- **HANDOFF M3 follow-ups**: terminal command quoting (`%VAR%` expanded twice through `start`, no `/s` on the `wt` path), the packaged `entryFileUrl` check, the electron-builder/winstaller check, and editor paths with spaces.

One PR (owner's choice), on `m3-static-ship`.

**Not in M3:** auto-update, code signing, macOS builds (v2), editing `.claude/` files other than the two Markdown files, MCP server management, multiple static servers per package.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | How many static servers | **Owner's choice: one per project or workspace package.** Its config lives in the root project's `toolSettings.static.servers[relPath]` (`relPath` '' = root): `{ folder, port, spa, https, lan, cors, noCache, latencyMs }`. `Project.staticServer` stays unused, like `envProfiles`. A "Running servers" strip on the tab lists every running server across projects. |
| 2 | Default folder and port | The folder defaults to the detected build output (`dist`/`build`), else the package folder. The port defaults to the first free port from **4173** upward (Vite's preview port, never the dev server's 5173/3000), checked by briefly binding it. |
| 3 | LAN exposure | **Off by default**: the server binds `127.0.0.1` until "Share on LAN" is switched on, then `0.0.0.0`, and the tab shows the LAN URL(s) and a QR code. The spec binds `0.0.0.0` always; doing that by default would expose a folder to the whole network (and trigger a Windows Firewall prompt) without being asked. |
| 4 | What is served | `sirv` with `dotfiles: false`, so `.env`, `.git` and friends are never served, plus `etag`, and `single: true` when SPA fallback is on. Serving the package root itself is allowed but the tab warns that source files are exposed. |
| 5 | HTTPS certificate | **Owner's choice: one per machine, kept.** Generated with `selfsigned` for `localhost`, `127.0.0.1` and the current LAN IPv4 addresses, stored in `userData/static-cert.json`, valid for a year. It is regenerated when a current LAN IP isn't covered or it expires within 30 days. The key never leaves main and is never logged. |
| 6 | Toggles | CORS adds `Access-Control-Allow-Origin: *` (and answers preflight); no-cache adds `Cache-Control: no-store`; latency delays every response by 0–5000 ms. Toggles apply on the next start (the tab says "restart to apply" when a running server's config changed). |
| 7 | Request log | Each request is one line (`200 GET /assets/app.js 3 ms`, status coloured with ANSI) in a per-server ring buffer (2 000 lines) emitted to the renderer like script logs. **`LogPane` is generalised** to take a log source (snapshot + `logs` events), so the static tab reuses it with search and filters. Query strings are dropped from logged paths (they can carry tokens). |
| 8 | QR code | Rendered in the renderer from `qrcode`'s module matrix as SVG `<rect>`s (no data URLs, no `innerHTML`), so the CSP stays as it is. |
| 9 | Markdown preview | **Owner's choice: rendered preview + editor.** `react-markdown` with `remark-gfm`, raw HTML disabled, links opened in the external browser through main (`shell.openExternal`, `http(s)` only). Edits use the M2 versioned-write pattern (CONFLICT on a stale version), keep the file's line endings, and can create a missing file. |
| 10 | Reading Claude Code files | One module, `src/main/tools/claude/claude-files.ts`, parses defensively: commands (`.claude/commands/**/*.md`), agents (`.claude/agents/*.md`, name and description from front matter), skills (`.claude/skills/*/SKILL.md`), settings (`permissions.allow/deny/ask`, hook event names) from `settings.json` and `settings.local.json`, and `.mcp.json` servers by **name, command and argument count only** (arguments and `env` can hold tokens; they are never read into the result). Anything that fails to parse is listed as "unreadable" with its file name. |
| 11 | Gitignore warning | `git check-ignore -q <file>` in the project folder for `CLAUDE.local.md` and `.claude/settings.local.json`; no git or not a repository → no warning, shown as "unknown". |
| 12 | `claude` status | `commandExists('claude')`, then `claude --version` through `cmdInvocation` (it is a `.cmd` shim), 10 s timeout, version text trimmed to the first line. Cached for 60 s. |
| 13 | Open / Continue | `openTerminal(cwd, 'claude')` and `openTerminal(cwd, 'claude --continue')`. The HANDOFF bug is fixed first: the `start` fallback quotes the command so `%VAR%` is not expanded twice, and the `wt` path runs `cmd.exe /d /s /k`. Both paths get unit tests for `%`, `&`, `^` and spaces. |
| 14 | Quick prompt with arbitrary text | Prompts contain quotes and newlines, which can't pass through `cmd.exe` safely (`assertCmdSafe`). **The prompt goes through stdin**: a new adapter method `spawnCommand(command, args, { cwd, env, stdin })` runs `cmd.exe /d /s /c "claude -p"` and writes the prompt to stdin, then closes it. One run at a time per project; output streams into a log pane like the request log; Stop kills the tree. No permission-skipping flags are ever added. |
| 15 | Context generator | Main builds the block from what NestBox already knows: package manager, scripts (names and commands), run groups, workspace packages, Prisma schema location, Docker Compose file, `PORT` from the env tool, and **key names** from `.env.example` (never values). It returns `{ before, after }` for `CLAUDE.md`; the renderer shows a line diff (`diff` package) and Apply writes it with the version check. Only the text between `<!-- nestbox:start -->` and `<!-- nestbox:end -->` changes; without markers, the block is appended. |
| 16 | Command palette | `cmdk` (the library behind shadcn's Command), written by hand in the new-york style because the registry is blocked. `Ctrl+K` (and `⌘K` once macOS lands) from anywhere except inside a text field that already handles it. Groups: Projects, Tools (of the selected project), Scripts ("Run dev in shop" starts it and opens its log), Run groups, Claude ("Claude: open shop", "Claude: continue shop"), Go to (Ports, Settings). |
| 17 | Release | `.github/workflows/release.yml`: on `v*` tags (and manual dispatch), windows-latest builds with `electron-builder --win --publish never` and uploads `NestBox-Setup-<version>.exe` to a GitHub Release (draft) with `softprops/action-gh-release`. Unsigned; the README explains the SmartScreen warning. |
| 18 | Packaged app check (HANDOFF) | CI gains a `package (windows-latest)` job: `electron-builder --win --dir`, then a Playwright smoke test launches `release/*/win-unpacked/NestBox.exe` and checks the window loads and IPC works (`app:getInfo`). That proves `isAppUrl` accepts the asar `entryFileUrl` in a real package. |
| 19 | README assets | Screenshots of the main views are captured by a script (`scripts/screenshots.ts`, Playwright against the built app with fixture projects) so they can be refreshed. A GIF needs a real Windows session: the README gets the screenshots now and a placeholder for the GIF, which the owner records. |
| 20 | Wordmark outlines | `resources/brand/svg/nestbox-lockup.svg` has live text. A one-off script converts it to paths with `opentype.js` and the bundled Inter font, writing `nestbox-lockup-outlined.svg`; the README uses that file. |

## Static server tool

`src/shared/tools/static/contract.ts`, `src/main/tools/static/`, `src/renderer/tools/static/`. `appliesTo`: always.

- **Main.** `StaticServers` (inside the tool factory) keeps one `http.Server`/`https.Server` per project id, built from a tiny handler chain: latency → headers (CORS, no-cache) → `sirv` → 404. Each request appends a log line and emits `logs` (batched every 50 ms like scripts). Methods: `config`, `setConfig`, `start`, `stop`, `status` (running, URLs, LAN URLs, port), `running` (all running servers, for the strip), `getLogs`, `clearLogs`, `pickFolder` (native dialog, injected). Start errors: `EADDRINUSE` → CONFLICT "Port 4173 is in use" (the tab offers "Use the next free port"); missing folder → NOT_FOUND.
- **Lifecycle.** `dispose` closes every server (part of the graceful quit); `forgetProject` stops the project's server.
- **Renderer.** A config form (folder with Browse, port, SPA, HTTPS, Share on LAN, CORS, no-cache, latency slider), Start/Stop, URLs with copy and "Open in browser", a QR code when shared on LAN, the request log pane, and the running servers strip. An Overview card shows status and URL.

## Claude Code tool

`src/shared/tools/claude/contract.ts`, `src/main/tools/claude/`, `src/renderer/tools/claude/`. `appliesTo`: always (it is about readiness, so a project with no Claude files still shows what's missing).

- **Methods.** `status` (`{ cli: { found, version } , files: …, gitignore: …, mcp: …, dotClaude: … }`), `readDoc({ file })` and `writeDoc({ file, text, version })` for the two Markdown files, `open`, `continue`, `prompt({ text })`, `stopPrompt`, `getPromptLogs`, `contextPreview` → `{ before, after, version }`, `applyContext({ version })`.
- **Panel.** Status header (CLI found + version, or how to install), two document cards with preview/edit, `.claude/` lists (commands, agents, skills, settings summary), MCP servers, gitignore warnings, action buttons, the quick prompt box with its log pane, and the context generator with the diff and Apply.

## Command palette

`src/renderer/app/CommandPalette.tsx` over a hand-written `components/ui/command.tsx` (cmdk). Mounted once in `App`. It reads the existing queries (projects, processes, run groups through the scripts tool's `list`) and runs actions through existing hooks; no new IPC except the Claude tool's `open`/`continue`.

## Security notes

- The static server never serves dotfiles, logs no query strings, and binds to localhost unless LAN sharing is switched on.
- `.mcp.json` arguments and `env` are never read into results; `.env.example` contributes key names only.
- The quick prompt passes text only through stdin, never through a command line.
- Links from rendered Markdown open externally only for `http:`/`https:`.

## Testing

- **Unit.** Static handler chain against real `http` on port 0 (SPA fallback, dotfiles refused, CORS/no-cache headers, latency with fake timers, log lines without query strings), cert reuse/regeneration rules, port picking, Claude file parsing on a fixture `.claude/` tree (malformed JSON, missing folders, MCP args never returned), the context block builder and marker replacement, terminal quoting for both paths, `spawnCommand` stdin, the palette's entries and actions, the generalised `LogPane` source.
- **Integration (Windows CI).** `spawnCommand` writes stdin to a real `node -e` reader; `openTerminal` quoting with a `%PATH%` literal.
- **End-to-end (Windows CI).** Start a static server on a fixture `dist` folder, fetch `/` and a deep route (SPA), see both in the request log. Palette: `Ctrl+K`, type a script name, run it, see its log.
- **Packaged.** The `package (windows-latest)` smoke test (decision 18).
