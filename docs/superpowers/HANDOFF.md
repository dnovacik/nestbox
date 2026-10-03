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
    - **Windows current-folder lookup.** `spawnCommand` (`claude -p`, and since v1.3.0 the database tool's Prisma commands) still lets cmd.exe find a program in the project folder. `execCommand` now sets `NoDefaultCurrentDirectoryInExePath`, but `spawnCommand` passes its env on to Claude's own commands, so it needs a resolved absolute path instead (`where` from NestBox's own folder, cached).
    - **Project header branch.** The header's branch comes from detection and only updates on a project refresh. The git tool's `changed` event could also refresh detection.
- v1.2.0 (git glance) and v1.2.1 (panel scrolling, one tab inset) are released.
- Database panel (the second v2 tool): branch `v2-database`, draft PR #11, version 1.3.0 in `package.json`.
  - Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-database-design.md` (approved). Plan: `docs/superpowers/plans/2026-10-03-nestbox-v2-database.md`.
  - Owner's answers: TCP check plus a Test login button; Prisma or env files; status/generate in the panel, migrate dev in a terminal, Studio in the background; show provider, host, port and database only.
  - Not verifiable in CI: real Prisma commands and Studio against a real database (unit tests use a fake platform; the end-to-end spec uses a TCP stand-in).
- Next v2 tools, smallest first: TODO scanner, health checks, Docker Compose, mock API, request inspector.
- Still open from v1: record the README GIF on Windows.

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
