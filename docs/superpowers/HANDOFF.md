# Handoff (read this first in a new or cloud session)

**State as of 2026-10-01**

- M0 (Skeleton) is complete on branch `m0-skeleton`.
- Draft PR #1 is open on `dnovacik/nestbox`, and CI is green on windows-latest and macos-latest. 223 tests pass.
- M1 has not started. It needs the owner's go-ahead.

**Read, in order**

1. `CLAUDE.md`: commands, structure, conventions, gotchas.
2. `docs/nestbox-spec.md`: the source of truth.
3. `docs/superpowers/specs/2026-10-01-nestbox-m0-design.md` and `docs/superpowers/plans/2026-10-01-nestbox-m0-skeleton.md`. The plan ends with the M1–M3 outlines.

**Workflow the owner expects**

- Use Superpowers in this order: brainstorming, writing-plans, then stop for approval.
- Execute with subagent-driven-development and TDD in a git worktree.
- Finish with verification-before-completion and requesting-code-review.
- Stop with a summary after each milestone.
- Commits are conventional and end with the trailer the session's attribution gives.
- Owner identity in this repo: Daniel Novacik <novacik.daniel@gmail.com>.

**Open follow-ups from the M0 reviews (feed into the M1 plan)**

*M1*
- **Startup:** create the window before detection finishes, detect lazily, and use `allSettled` in init.
- **Stale data:** invalidate the `['tool']` queries on `projects:changed`.
- **Graceful quit:** prevent the default in `before-quit`, await `toolHost.disposeAll()` with a timeout, then quit. Log `dispose` failures.
- **Missing editor:** run a `where code` pre-check and return NOT_FOUND with a helpful message.
- **Store writes:** handle `store.write()` failures on the defaults and after-backup paths. Fix the misleading "Store reset" wording on backup failure. Consider a read-only mode for newer schema versions.
- **IPC hardening:** fail closed if `isTrustedSender` throws, bound the size of `tools:invoke` input, and add `web-contents-created` hardening.
- **Tool errors:** add a test that tool errors exclude input values.
- **UI:**
  - the "All projects" count ignores the filter, and there's no "no matches" hint
  - the Project info card has no skeleton or error state
  - ToolTabs lacks `aria-controls`, `tabpanel` and arrow-key support
- **Test gaps:** pending state and the stale-selection fallback, the other mutation hooks, "add when detect throws", and the title bar workspace display.

*M2*
- **Detection:** warn when `readdir` fails, stop matching `.envrc` as an env file, and handle symlinks, including symlinked workspaces that point outside the root.

*M3*
- **Terminal commands:** `openTerminal` with a command expands `%VAR%` twice through `start`, and the `wt` path has no `/s`. Do an end-to-end test with `claude`.
- **Packaging:** check the asar `entryFileUrl` against the `loadFile` URL, and recheck electron-winstaller's build script.
- **Editor command:** check editor paths that contain spaces.

**Machine notes (owner's Windows box)**

- No Windows Terminal is installed, so the `cmd` fallback is the path that actually runs.
- `gh` is installed and authenticated.
- The `origin` remote uses HTTPS.
