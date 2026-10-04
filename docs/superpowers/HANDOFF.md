# Handoff (read this first in a new or cloud session)

**State as of 2026-10-03**

- M0–M3 are merged to `main` (PRs #1–#4). v1 is done.
  - The v1.0.0 draft release (built by the release workflow from `49a36cb`, `NestBox-Setup-1.0.0.exe`) waits for the owner to press Publish.
  - Publishing creates the `v1.0.0` tag. Cloud sessions can't push tags or edit releases.
- v2 has started with the macOS build: branch `v2-macos`, draft PR #5, version 1.1.0 in `package.json`.
  - Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-macos-design.md` (approved). Plan: `docs/superpowers/plans/2026-10-03-nestbox-v2-macos.md`.
  - All plan tasks are done.
  - CI runs unit, integration, end-to-end and packaged smoke tests on both OSes. The x64 app runs under Rosetta.
  - The code review's findings are fixed:
    - `killTree(1)` is refused;
    - the shell env survives a profile that starts a background job;
    - VS Code opens files through its `vscode://` URL;
    - Ghostty commands run through the login shell;
    - orphans are found by process group;
    - smaller robustness fixes.
  - Not verifiable in CI, so it needs a real Mac before "preview" is dropped from the README: the terminal routes (iTerm and Terminal running a `.command` file; Ghostty `-e`), the VS Code URL, the menu-bar icon and the first-launch Gatekeeper steps.
  - Release after merging: run the release workflow on `main` (or push tag `v1.1.0` from a machine), then publish the draft. It holds the installer and both DMGs.
- v1.1.0 (macOS preview) is released: PRs #5–#7 merged, the draft published by the owner.
- Git glance (the first v2 tool): branch `v2-git-glance`, draft PR #8, version 1.2.0 in `package.json`.
  - Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-git-glance-design.md` (approved). Plan: `docs/superpowers/plans/2026-10-03-nestbox-v2-git-glance.md`.
  - Owner's answers: never fetch; refresh on `.git` changes and on window focus.
  - Release after merging: run the release workflow on `main`, then the owner publishes the draft.
  - Follow-ups:
    - **Windows current-folder lookup.** Fixed in the follow-ups PR (#17): `spawnCommand` resolves the program from PATH.
    - **Project header branch.** Fixed in the follow-ups PR (#17): the header uses the git tool's live status.
- v1.2.0 (git glance) and v1.2.1 (panel scrolling, one tab inset) are released.
- Database panel (the second v2 tool): branch `v2-database`, draft PR #11, version 1.3.0 in `package.json`.
  - Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-database-design.md` (approved). Plan: `docs/superpowers/plans/2026-10-03-nestbox-v2-database.md`.
  - Owner's answers: TCP check plus a Test login button; Prisma or env files; status/generate in the panel, migrate dev in a terminal, Studio in the background; show provider, host, port and database only.
  - Not verifiable in CI: real Prisma commands and Studio against a real database (unit tests use a fake platform; the end-to-end spec uses a TCP stand-in).
- v1.3.0 (database panel) is released. The repository is public since then (Actions minutes ran out while it was private); the packaged smoke test allows a cold Rosetta launch of the x64 app.
- TODO scanner (the third v2 tool): branch `v2-todos`, draft PR #12, version 1.4.0 in `package.json`.
  - Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-todos-design.md` (approved). Plan: `docs/superpowers/plans/2026-10-03-nestbox-v2-todos.md`.
  - Owner's answers: git file list, else a walk; default tags plus a setting; scan on first view and Refresh; open in the editor at the line.
- v1.4.0 (TODO scanner) is released.
- Health checks (the fourth v2 tool): branch `v2-health`, draft PR #13, version 1.5.0 in `package.json`.
  - Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-health-design.md` (approved). Plan: `docs/superpowers/plans/2026-10-03-nestbox-v2-health.md`.
  - Owner's answers: user-defined checks plus suggestions; run while a script runs; healthy = 2xx/3xx within 5 s; desktop notification on ok→fail.
  - Not verifiable in CI: the desktop notification itself and its click (unit tests check when `notify` is called).
- v1.5.0 (health checks) is merged and its release draft built (PR #13); the owner publishes it.
- Docker Compose (the fifth v2 tool): branch `v2-compose`, draft PR #14, version 1.6.0 in `package.json`.
  - Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-compose-design.md` (approved). Plan: `docs/superpowers/plans/2026-10-04-nestbox-v2-compose.md`.
  - Owner's answers: per-service and stack actions; Stop keeps containers, Down after a confirmation; one service's logs in the log viewer; not part of run groups yet.
  - Not verifiable in CI: a real `docker compose` (the e2e specs use `e2e/fixtures/fake-docker`).
- v1.6.0 (Docker Compose) is merged and its release draft built (PR #14); the owner publishes it.
- Mock API (the sixth v2 tool): branch `v2-mock-api`, draft PR #15, version 1.7.0 in `package.json`.
  - Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-mock-api-design.md` (approved). Plan: `docs/superpowers/plans/2026-10-04-nestbox-v2-mock-api.md`.
  - Owner's answers: saved in NestBox settings; static JSON with `:params` and placeholders; per-route and global delay/fail; 404 plus a request log.
- v1.7.0 (mock API) is merged and its release draft built (PR #15). The owner is away from their PC: v1.6.0 and v1.7.0 drafts wait to be published and tested together.
- Request inspector (the seventh v2 tool): branch `v2-inspector`, draft PR #16, version 1.8.0 in `package.json`.
  - Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-inspector-design.md` (owner's answers; continued without a separate approval stop). Plan: `docs/superpowers/plans/2026-10-04-nestbox-v2-inspector.md`.
  - Owner's answers: a proxy in front of the API; full request/response in memory with secret headers masked; Replay plus Edit & send; target from PORT, editable to local addresses.
  - Also fixes the tool tab bar, which overflowed the window once there were twelve tools.
- Follow-up fixes: branch `v2-followups` (stacked on `v2-inspector`), draft PR #17, released with 1.8.0. `spawnCommand` on Windows resolves the program from PATH (never the project folder), and the header's branch follows the git tool's live status.
- Inspector tunnel: branch `v2-tunnel` (stacked on `v2-followups`), draft PR #18, version 1.9.0. Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-tunnel-design.md` (defaults chosen while the owner was away; review with the PR). Not verifiable in CI: a real cloudflared quick tunnel and a real webhook (the e2e uses a fake cloudflared).
- Release order: 1.6.0 and 1.7.0 drafts (published by the owner), then #16 + #17 as 1.8.0, then #18 as 1.9.0.
- Portfolio items from the spec: branch `v2-portfolio` (stacked on `v2-tunnel`), docs only, no version bump. It adds screenshots of the v2 tools (made by `scripts/screenshots.mjs`), `CONTRIBUTING.md` and a write-up of a hard problem (`docs/writeups/process-trees.md`). It can merge with or after #18.
- Compose in run groups: branch `v2-compose-groups` (stacked on `v2-portfolio`), version 1.10.0. Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-compose-groups-design.md` (the owner picked this follow-up; defaults chosen without approval stops, review with the PR). Not verifiable in CI: a real `docker compose up --wait` with healthchecks (the e2e uses the fake docker).
- Node version check: branch `v2-node-check` (stacked on `v2-compose-groups`), version 1.11.0. From the owner's write-up; design `docs/superpowers/specs/2026-10-04-nestbox-v2-node-check-design.md`. Owner's answers: Node check first, then Dependency health; warn in the log and start; a per-project fnm switch; a card and a tab. Not verifiable in CI: fnm, Volta and nvm-windows themselves, and Corepack offline behaviour (unit tests fake `execCommand`).
- Next: Dependency health (1.12.0), the spec's network exception.
- Next: the planned v2 tools, follow-ups and portfolio docs are done. Still open from v1: record the README GIF on Windows.

**Read, in order**

1. `CLAUDE.md`: commands, structure, conventions, gotchas.
2. `docs/nestbox-spec.md`: the source of truth.
3. The milestone designs and plans in `docs/superpowers/specs/` and `docs/superpowers/plans/`. The M0 plan ends with the M1–M3 outlines.

**Workflow the owner expects**

- Use Superpowers in this order: brainstorming, writing-plans, then stop for approval.
- Execute with subagent-driven-development and TDD in a git worktree.
- Finish with verification-before-completion and requesting-code-review.
- Stop with a summary after each milestone.
- Commits are conventional and end with the trailer the session's attribution gives.
- Owner identity in this repo: Daniel Novacik <novacik.daniel@gmail.com>.
- One PR per milestone, from its own branch (`m1-scripts-logs`, then e.g. `m2-ports-env`), merged to `main`.

**Cloud-session notes**

- Superpowers isn't installed in cloud sessions: the same steps are followed by hand.
- `ui.shadcn.com` was blocked by the network policy, so `components/ui/dialog.tsx`, `switch.tsx` and `select.tsx` are hand-written (new-york style). Regenerate them with the CLI when it is reachable.
- The Electron binary can be installed (`node node_modules/electron/install.js`), and the built app runs under `xvfb-run`. On Linux the platform adapter is the macOS stub, so scripts cannot start, but the UI and IPC can be checked with Playwright.

**M1 follow-ups (from M0 reviews): all done in PR #2**

Startup, stale data, graceful quit, missing editor, store writes and read-only mode, IPC hardening, tool error hygiene, the UI items and the test gaps.

**Open follow-ups**

- **Orphans.** The PID ledger records each script root's spawn time (PowerShell can take over 10 s cold). At startup one `listProcesses` call feeds `findOrphans`, which offers a live root within 3 s of it, or the children a dead root `cmd.exe` left behind.

*Before or during M3*
- **Log performance at very large buffers.** Every 50 ms batch copies the renderer's line array, and an active search rescans every line. That's fine at the default 50 000 lines but heavy near the 1 000 000 maximum. Consider a chunked store and incremental search hits. (M1 review #8; contexts are already incremental.)
- **Notifications in `pnpm dev`.** Windows only shows toasts for an app with an AppUserModelID and a Start-menu shortcut. Check them in a packaged build.

*M2 leftovers*
- **Port listing on macOS** stays a stub until the v2 macOS phase (`lsof -iTCP -sTCP:LISTEN`).
- **Env variable expansion** (`${VAR}`) is shown and written verbatim; no dotenv-expand preview.
- **Attribution cost.** The first owner lookup runs PowerShell (seconds when cold). A persistent PowerShell or a native module could make it instant if it matters in daily use.

*M3 leftovers*
- **Quick prompt output.** `claude -p` prints its answer when it finishes (no streaming without `--output-format stream-json`). Parsing stream JSON would show progress; not needed for v1.
- **Context block.** Facts come from detection and the env tool; framework detection (Next, Vite, Nest) would make it richer.
- **Static on macOS** works (Node only); LAN addresses and the certificate are platform-neutral.
- **Editor command:** check editor paths that contain spaces (the `where` pre-check handles `dir:pattern`; the launch through `cmd.exe` still needs a test with a real path).
- **Code signing.** The installer is unsigned (README explains SmartScreen). A certificate would go into the release workflow as a secret.

**Machine notes (owner's Windows box)**

- No Windows Terminal is installed, so the `cmd` fallback is the path that actually runs.
- `gh` is installed and authenticated.
- The `origin` remote uses HTTPS.
