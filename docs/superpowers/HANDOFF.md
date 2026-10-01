# Handoff (read this first in a new or cloud session)

**State as of 2026-10-01**

- M0 (Skeleton) and M1 (Scripts and logs) are merged to `main` (PRs #1 and #2).
- M2 (Ports and env) is implemented on branch `m2-ports-env`, in draft PR #3 on `dnovacik/nestbox`.
  - Design: `docs/superpowers/specs/2026-10-01-nestbox-m2-design.md` (approved). Plan: `docs/superpowers/plans/2026-10-01-nestbox-m2-ports-env.md`.
  - A global Ports page (sidebar), a Ports card on each Overview with the watch list, "Kill and restart" on `EADDRINUSE`, and the Env tool (matrix, masked values, copy without reveal, edits that keep formatting, profiles).
  - New e2e tests: Ports attribution and stop (Windows), env add-from-example.
  - What's left before merging: the owner's manual checklist on Windows (in the PR body), then marking the PR ready.
- M3 has not started. It needs the owner's go-ahead.

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

*M3*
- **Terminal commands:** `openTerminal` with a command expands `%VAR%` twice through `start`, and the `wt` path has no `/s`. Do an end-to-end test with `claude`.
- **Packaging:** check the asar `entryFileUrl` against the `loadFile` URL, and recheck electron-winstaller's build script.
- **Editor command:** check editor paths that contain spaces (the `where` pre-check handles `dir:pattern`; the launch through `cmd.exe` still needs a test with a real path).

**Machine notes (owner's Windows box)**

- No Windows Terminal is installed, so the `cmd` fallback is the path that actually runs.
- `gh` is installed and authenticated.
- The `origin` remote uses HTTPS.
