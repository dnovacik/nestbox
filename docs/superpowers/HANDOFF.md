# Handoff (read this first in a new or cloud session)

**State as of 2026-10-01**

- M0 (Skeleton) is merged to `main` (PR #1).
- M1 (Scripts and logs) is implemented on branch `m1-scripts-logs`, in draft PR #2 on `dnovacik/nestbox`.
  - Lint, typecheck, 575 unit tests (4 Windows-only skipped elsewhere) and the build pass on windows-latest and macos-latest.
  - A new `e2e (windows-latest)` CI job runs Playwright against the built app: start, output, stop the whole tree, crash display, quit.
  - What's left before merging: the owner's manual checklist on Windows (in the PR body), then marking the PR ready.
- M2 has not started. It needs the owner's go-ahead.

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
- `ui.shadcn.com` was blocked by the network policy, so `components/ui/dialog.tsx` and `switch.tsx` are hand-written (new-york style). Regenerate them with the CLI when it is reachable.
- The Electron binary can be installed (`node node_modules/electron/install.js`), and the built app runs under `xvfb-run`. On Linux the platform adapter is the macOS stub, so scripts cannot start, but the UI and IPC can be checked with Playwright.

**M1 follow-ups (from M0 reviews): all done in PR #2**

Startup, stale data, graceful quit, missing editor, store writes and read-only mode, IPC hardening, tool error hygiene, the UI items and the test gaps.

**Open follow-ups**

*Before or during M2*
- **Log performance at very large buffers.** Every 50 ms batch copies the renderer's line array, and an active search rescans every line. That's fine at the default 50 000 lines but heavy near the 1 000 000 maximum. Consider a chunked store and incremental search hits. (M1 review #8; contexts are already incremental.)
- **Tool calls during detection.** `tools:invoke` fails with NOT_FOUND while a project is still being detected at startup. Panels recover (log panes retry every 2 s; queries refetch), but a short wait in `getDetected` would be cleaner.
- **Notifications in `pnpm dev`.** Windows only shows toasts for an app with an AppUserModelID and a Start-menu shortcut. Check them in a packaged build.

*M2*
- **Detection:** warn when `readdir` fails, stop matching `.envrc` as an env file, and handle symlinks, including symlinked workspaces that point outside the root.
- **Ports:** read the `scripts.processes` shared fact (`{ script, pid, state }[]` per project) to attribute ports.

*M3*
- **Terminal commands:** `openTerminal` with a command expands `%VAR%` twice through `start`, and the `wt` path has no `/s`. Do an end-to-end test with `claude`.
- **Packaging:** check the asar `entryFileUrl` against the `loadFile` URL, and recheck electron-winstaller's build script.
- **Editor command:** check editor paths that contain spaces (the `where` pre-check handles `dir:pattern`; the launch through `cmd.exe` still needs a test with a real path).

**Machine notes (owner's Windows box)**

- No Windows Terminal is installed, so the `cmd` fallback is the path that actually runs.
- `gh` is installed and authenticated.
- The `origin` remote uses HTTPS.
