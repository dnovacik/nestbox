# NestBox M3 (Static server and ship) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-01-nestbox-m3-design.md` (decisions referenced as D1…D20).
> Branch: `m3-static-ship` from `main` (after PR #3). One PR (owner's choice), merged when the owner has tested it.
> Every task is TDD: the failing Vitest test next to the source first, then the code, then `pnpm typecheck && pnpm lint && pnpm test`. Conventional commits with the session trailer.

**Goal.** The static server and Claude Code tools, the command palette, the release pipeline and the README, so v1 can be tagged.

**New dependencies.** Runtime (`dependencies`, main): `sirv`, `selfsigned`. Renderer (`devDependencies`): `qrcode`, `react-markdown`, `remark-gfm`, `diff`, `cmdk`. Tooling (`devDependencies`): `opentype.js`. Check each is MIT/ISC and pin exact versions.

---

## Part A: Foundations

### Task 1: Terminal command quoting (D13, HANDOFF)

**Files:** `src/main/platform/win32.ts`, `win32-escape.ts`, `win32.test.ts`, `win32.integration.test.ts`.

1. Tests: the `start` fallback line for `claude --continue` and for a command containing `%PATH%`, `&`, `^`; the `wt` args end with `cmd.exe /d /s /k <escaped>`; an editor path with spaces (`C:\Program Files\Microsoft VS Code\bin\code.cmd`) reaches `cmdInvocation` intact.
2. Fix: escape `%` in the `start` path (`escapeCmdArg` already handles `^`, `&`; `%` becomes `%%` inside `start`'s re-parse only), add `/d /s` on the `wt` path.
3. Integration (Windows): `openTerminal` is not launched in CI (it opens windows); instead test the built command lines through a runner spy and run `cmd.exe /d /s /c "echo <escaped>"` to prove `%PATH%` stays literal.

### Task 2: `spawnCommand` with stdin (D14)

**Files:** `src/main/platform/adapter.ts`, `win32.ts`, `darwin.ts`, `command-runner.ts`, tests, `fake-child.ts`.

```ts
spawnCommand(opts: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; stdin?: string }): ChildProcess;
```
Through `cmdInvocation` like `spawnScript`; when `stdin` is set the pipe is opened, written and ended. Tests with the fake runner; integration with `node -e "process.stdin.pipe(process.stdout)"`.

### Task 3: Generic log source for `LogPane` (D7)

**Files:** `src/renderer/tools/scripts/LogPane.tsx`, `use-log-stream.ts`, a new `src/renderer/components/log/` home for `LogPane`, `LogRow`, `LogToolbar`, `line-store`, `ansi`, `structured`, `filters`, `links` (moved, re-exported for scripts), tests moved with them.

```ts
interface LogSource {
  key: string;                       // re-subscribe when it changes
  snapshot(afterSeq?: number): Promise<LogSnapshot>;
  subscribe(onLines: (lines: LogLine[]) => void): () => void;
  clear?(): Promise<void>;
  export?(seqs: number[] | 'all'): Promise<void>;
}
```
`useLogStream(source)` replaces the scripts-specific stream; scripts builds its source from `getLogs`/`logs` events. The script picker and the EADDRINUSE banner stay in the scripts wrapper. All existing LogPane tests keep passing unchanged in behaviour.

### Task 4: `app:openExternal` (D9)

**Files:** `src/shared/ipc-names.ts`, `channels.ts`, `client.ts`, `src/main/ipc/core-handlers.ts`, tests, `index.ts`.

Input `{ url }`; only `http:`/`https:` URLs (parsed with `URL`), else VALIDATION; calls `shell.openExternal`. Used by Markdown links, "Open in browser" and the README link in Settings.

---

## Part B: Static server

### Task 5: Contract and settings (D1, D2, D6)

**Files:** `src/shared/tools/static/contract.ts`, `src/shared/tools/index.ts`.

Settings: `{ servers: Record<relPath, ServerConfig> }` with defaults; `ServerConfig = { folder: string | null, port: number | null, spa: true, https: false, lan: false, cors: false, noCache: true, latencyMs: 0 }` (`null` = defaults). Methods and `logs` event as in the design.

### Task 6: Request handler chain (D4, D6, D7)

**Files:** `src/main/tools/static/handler.ts` (+ test against a real `http.createServer` on port 0 and a temp folder).

Tests: serves `index.html` and assets with ETags; SPA on → `/deep/route` returns `index.html`, off → 404; `/.env` and `/.git/config` → 404 even when present; CORS header and an `OPTIONS` preflight answered 204; `Cache-Control: no-store` with no-cache; latency delays (fake timers); `onRequest` receives `{ method, path (no query), status, ms }`.

### Task 7: Certificate store (D5)

**Files:** `src/main/tools/static/cert-store.ts` (+ test with an injected generator and clock).

`getCertificate({ ips })` reads `static-cert.json`, reuses it when every IP is covered and it is valid for 30+ more days, else generates (`selfsigned`, 2048-bit, SAN localhost/127.0.0.1/ips, 365 days) and writes it atomically. Corrupt file → regenerate. Never logs PEM text.

### Task 8: Ports and addresses (D2, D3)

**Files:** `src/main/tools/static/net.ts` (+ test).

`firstFreePort(start, host)` tries `listen` on each port up to start+50; `lanAddresses()` from `os.networkInterfaces()` (IPv4, non-internal, no link-local), injected for tests.

### Task 9: Static tool main (D1–D7)

**Files:** `src/main/tools/static/index.ts` (+ test), `src/main/tools/index.ts`, `src/main/index.ts`.

Factory deps: `{ certStore, pickFolder, lanAddresses, logger }`. Tests start a real server on a temp `dist` folder: start/status/URLs, LAN off binds 127.0.0.1 and reports no LAN URLs, CONFLICT on a busy port, log lines emitted and readable through `getLogs`, stop, `running` across two projects, `dispose` closes all, `forgetProject` stops one, config defaults from detection (`buildOutput`).

### Task 10: Static panel, QR, overview card

**Files:** `src/renderer/tools/static/` (`Panel.tsx`, `ConfigForm.tsx`, `QrCode.tsx`, `RunningServers.tsx`, `use-static.ts`, `OverviewCard.tsx`, `index.ts`) + tests; registry and icon (`server`).

Tests: form saves config; Start shows URLs; LAN toggle shows LAN URL and a QR `svg` with rects; "restart to apply" after editing a running config; CONFLICT offers "Use the next free port"; request log lines appear from `logs` events; the root-folder warning.

---

## Part C: Claude Code

### Task 11: Claude file reader (D10)

**Files:** `src/main/tools/claude/claude-files.ts` (+ test with a fixture tree in a temp folder).

Returns commands, agents (front matter name/description), skills, settings summaries per file (`allow`/`deny`/`ask` counts and entries, hook event names), MCP servers (`name`, `command`, `argCount`), and `unreadable: string[]`. Tests include malformed JSON, missing folders, nested commands, and **a `.mcp.json` whose args and env contain a token that must not appear anywhere in the result**.

### Task 12: CLI status and gitignore (D11, D12)

**Files:** `src/main/tools/claude/cli.ts` (+ test with `scriptedExec`).

`claudeStatus()` (cached 60 s), `isIgnored(dir, file)` via `git check-ignore -q` (exit 0 → true, 1 → false, anything else → null).

### Task 13: Project text documents (D9)

**Files:** `src/main/tools/claude/docs.ts` (+ test), reusing the M2 versioned write: extract `src/main/fs/versioned-file.ts` from `env-files.ts` (read/write with version, atomic, size cap, symlink refusal) and make both env and Claude use it, each with its own allowed names.

### Task 14: Context generator (D15)

**Files:** `src/main/tools/claude/context.ts` (+ test).

`buildBlock(facts)` renders the Markdown section deterministically; `applyBlock(existing, block)` replaces between markers or appends (with one blank line), keeping line endings. Tests: markers replaced, hand-written text untouched, no markers → appended, empty file, CRLF, env key names only (a fixture value never appears).

### Task 15: Claude tool main (D12–D15)

**Files:** `src/shared/tools/claude/contract.ts`, `src/main/tools/claude/index.ts` (+ test), wiring.

Deps: `{ platform, files, scripts facts, envKeyNames, logger }`. Prompt runs: one per project, lines streamed as `prompt-logs` events, `stopPrompt` kills the tree, `dispose`/`forgetProject` kill runs. Tests with a fake `spawnCommand` child: stdin receives the prompt exactly, a second prompt while running → CONFLICT, output lines emitted, open/continue call `openTerminal` with the right command.

### Task 16: Claude panel

**Files:** `src/renderer/tools/claude/` (`Panel.tsx`, `DocCard.tsx`, `Markdown.tsx`, `ContextDiff.tsx`, `PromptBox.tsx`, `use-claude.ts`, `OverviewCard.tsx`, `index.ts`) + tests; registry and icon (`sparkles`).

Tests: CLI missing explains how to install; preview renders headings and no raw HTML (`<script>` shows as text); links call `app:openExternal`; edit saves with version, CONFLICT reloads; create a missing `CLAUDE.local.md`; gitignore warning; MCP list shows name and command only; context diff shows added/removed lines and Apply sends the version; prompt box streams lines and Stop.

---

## Part D: Command palette

### Task 17: Palette (D16)

**Files:** `src/renderer/components/ui/command.tsx` (hand-written, new-york), `src/renderer/app/CommandPalette.tsx`, `palette-entries.ts` (+ tests), `App.tsx`.

`paletteEntries({ projects, selected, processes, runGroups, tools })` is pure and tested: groups, labels, keywords (workspace names), disabled entries (running scripts show "Stop"). The component test: `Ctrl+K` opens, typing filters, Enter runs (select project, start script and open its log, open Claude), Escape closes, focus returns.

---

## Part E: Ship

### Task 18: Packaged smoke test (D18, HANDOFF)

**Files:** `.github/workflows/ci.yml` (new `package` job), `e2e/packaged.spec.ts`, `e2e/playwright.config.ts` (a `packaged` project).

`pnpm build && pnpm exec electron-builder --win --dir`, then launch `release/<version>/win-unpacked/NestBox.exe` with `_electron.launch({ executablePath })`, check the title, `app:getInfo` through the preload, and that a project can be added.

### Task 19: Release workflow (D17)

**Files:** `.github/workflows/release.yml`, `electron-builder.yml` (`artifactName: NestBox-Setup-${version}.${ext}`), `README.md` (install section).

On `v*` tags and `workflow_dispatch`: windows-latest, install, test, build, `electron-builder --win --publish never`, `softprops/action-gh-release` with `draft: true`. `permissions: contents: write`. No secrets beyond `GITHUB_TOKEN`.

### Task 20: Wordmark outlines (D20)

**Files:** `scripts/outline-wordmark.mjs`, `resources/brand/svg/nestbox-lockup-outlined.svg`.

Reads the lockup SVG, replaces each `<text>` with the `<path>` from `opentype.js` using the Inter variable font file from `@fontsource-variable/inter` at the same size, weight and position. A test renders both SVGs (Playwright screenshot) and compares bounding boxes within a tolerance; the visual diff is checked by eye.

### Task 21: Screenshots and README (D19)

**Files:** `scripts/screenshots.ts`, `docs/screenshots/*.png`, `README.md`.

Screenshots of Overview, Scripts (with logs), Ports, Env, Static and Claude, using fixture projects and stubbed IPC where the platform can't provide data. README: what it is, screenshots (GIF placeholder), install (SmartScreen note), development commands, architecture (process diagram, IPC, tool contract), "How to write a tool" (the CLAUDE.md steps as a walkthrough with the `project-info` example), security model, roadmap.

### Task 22: End-to-end

**Files:** `e2e/fixtures/npm-app/dist/index.html` (and `assets/app.js`), `e2e/static.spec.ts`, `e2e/palette.spec.ts`.

Static (runs on Linux and Windows): start, fetch `/` and `/deep/route`, see both in the log, stop. Palette (Windows; it starts a script): `Ctrl+K`, "serve", Enter, the log shows `listening`.

### Task 23: Docs, verification, review

- `CLAUDE.md`: new tools, `app:openExternal`, `spawnCommand`, the log source, static/claude gotchas, release steps.
- `HANDOFF.md`: state, v1 release steps (tag `v1.0.0`, publish the draft release), v2 notes.
- Full checks, Xvfb smoke of the new tabs, code review, fixes, PR checklist for Windows.
