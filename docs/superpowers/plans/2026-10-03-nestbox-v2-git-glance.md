# NestBox v2 (Git glance) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-git-glance-design.md` (decisions are referenced as D1…D14).
> Branch: `v2-git-glance` from `main` (after v1.1.0). It is one PR, released as v1.2.0 once CI is green on both OSes and the owner approves.
> Every task is TDD: write the failing Vitest test next to the source first, then the code, then run `pnpm typecheck && pnpm lint && pnpm test`. Commits are conventional and carry the session trailer.

**Goal.** Each project's overview shows a read-only Git card, and the Git tab lists the changed files.

**New dependencies.** None: `git` is the user's own, and a missing git is a handled state.

---

## Part A: Main

### Task 1: `maxBytes` for `execCommand` (D4)
**Files:** `platform/adapter.ts`, `win32.ts`, `darwin.ts`, `platform/testing.ts`, and the adapter tests.
- Add an optional `maxBytes` to `execCommand`'s options.
- Both adapters pass it through to `runner.exec`.
- Test: the runner spy receives it on each adapter.

### Task 2: Git directories (D5)
**Files:** `detection/git-head.ts` (+ test).
- Extract `resolveGitDirs(dir) → { gitDir, commonDir } | null` from `readGitInfo`.
- Linked worktrees: follow the `gitdir:` pointer, then the `commondir` file.
- `readGitInfo` uses the extracted function; its behaviour is unchanged.
- Tests: a `.git` folder, a worktree pointer with `commondir`, and a broken pointer (null).

### Task 3: Status parser (D3, D4, D7)
**Files:** `tools/git/status.ts` (+ test), with fixtures in `tools/git/__fixtures__/*.bin` (NUL bytes; mark `-text` in `.gitattributes`).
- `parseStatus(stdout, truncated)` returns the branch fields, the counts and `files` (capped at 500).
- Fixtures: clean; ahead 2 / behind 1; no upstream; detached; initial; a rename; unmerged; a path with a space and unicode; truncated (the cut record is dropped).

### Task 4: Commit parser and operation (D8, D9)
**Files:** `tools/git/commit.ts` (+ test), `tools/git/operation.ts` (+ test).
- `parseCommit(raw)`: author name and epoch, and the subject. Tests cover a signed commit, a multi-line message and unicode.
- `detectOperation(gitDir, exists)` follows the precedence in D8, with a fake `exists`.

### Task 5: Contract and registration (D1, D10, contract sketch)
**Files:**
- `shared/tools/git/contract.ts`: the definition (`git`, "Git", `git-branch`, `appliesTo: p.git !== null`, empty settings), the contract and the events;
- `shared/tools/index.ts`, plus its test.

Tests check the schemas: the discriminated union, and that `files` is limited to 500.

### Task 6: Watcher (D5)
**Files:** `tools/git/watcher.ts` (+ test).
- `createGitWatcher({ watch, setTimeout })`: per project, the gitDir (non-recursive) plus `commonDir/refs` (recursive).
- Ignores `*.lock`; sends one event 300 ms after the last change, and at most one per 1 s.
- Restarts on a path change; `stop(projectId)`, `forgetRoot(rootId)` and `disposeAll()`.
- The tests use fake timers and a fake `watch`.

### Task 7: Tool main (D2, D7, D10, D11, D12)
**Files:** `tools/git/index.ts` (+ test), `tools/index.ts` (wiring with the real `fs.watch` and `stat`).
- `status`:
  - runs the two `execCommand` calls with `cwd`, timeouts and `maxBytes`;
  - stats FETCH_HEAD and detects any operation in progress;
  - maps exit codes to the states;
  - starts the watcher.
- `openFile`: validates the path, checks the file exists, then calls `openInEditor`.
- Tests use a fake platform:
  - exit 128 → `not-a-repo`;
  - an `ENOENT`-like failure with `commandExists` false → `git-missing`;
  - a timeout → `failed`;
  - the cat-file call is skipped for an initial branch;
  - `openFile` rejects `../x`, `/abs` and `a\0b`;
  - the logger receives no paths or subjects.

### Task 8: Integration test (real git)
**Files:** `tools/git/git.integration.test.ts`.
- Runs on Windows and macOS CI when git is present; skipped elsewhere, like the platform integration files.
- Builds a temporary repo with a local `user.name`/`user.email` (no global config is touched).
- Checks the counts, the last commit, and that a commit fires the watcher's `changed`.

## Part B: Renderer

### Task 9: Hook and helpers (D6, D13)
**Files:** `renderer/tools/git/use-git.ts` (+ test), `renderer/lib/relative-time.ts` (+ test, unless a formatter already exists).
- `useGitStatus(projectId)`: a query that is invalidated on the `changed` tool event and on the `window` `focus` event.
- `useOpenGitFile`: a mutation that shows errors in a toast.

### Task 10: Overview card (D13)
**Files:** `renderer/tools/git/OverviewCard.tsx` (+ test).
- Shows every state and the skeleton.
- Shows "N+" when the status is truncated, "No upstream", and the operation badge.

### Task 11: Panel (D13)
**Files:** `renderer/tools/git/Panel.tsx` (+ test), `index.ts`, `tools/registry.ts`, `tools/icons.ts` (`git-branch`).
- The header plus the grouped lists, the Open buttons (none for deleted files), Refresh, and "and N more".

## Part C: Ship

### Task 12: End-to-end
**Files:** `e2e/git.spec.ts`.
- Copies a fixture project to a temporary folder, then runs `git init`, a commit and a modification.
- Adds the project and checks the Git card shows the branch and "1 change".
- Opens the Git tab and checks the file is listed.
- Skipped when git is missing.

### Task 13: Docs and version (D14)
**Files:** `package.json` (1.2.0), README (the tools list and a screenshot if `scripts/screenshots.mjs` can show the card), CLAUDE.md (a Git tool gotcha line), HANDOFF.

### Task 14: Verification and review
- Run lint, typecheck, test, build and e2e under `xvfb-run`.
- Run a code review of the whole diff and fix its findings.
- Open the PR and get CI green on both OSes.
- Stop for the owner's test and approval.
