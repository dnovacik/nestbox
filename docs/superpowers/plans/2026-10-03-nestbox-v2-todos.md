# NestBox v2 (TODO scanner) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-todos-design.md` (decisions are referenced as D1…D12).
> Branch: `v2-todos` from `main` (after v1.3.0). One PR, released as v1.4.0 once CI is green on both OSes and the owner approves.
> Every task is TDD: the failing Vitest test goes next to the source first, then the code, then `pnpm typecheck && pnpm lint && pnpm test`. Commits are conventional and carry the session trailer.

**Goal.** Every package gets a TODOs tab and a card. Comments tagged TODO, FIXME, HACK, XXX or BUG (the list is configurable) appear grouped by file, and each opens in the editor at its line.

**New dependency.** `ignore` (runtime, root `.gitignore` for the non-git walk). It is already in the lockfile as a transitive dependency.

---

## Part A: Main

### Task 1: Shared path check (D8)
**Files:** `src/main/fs/inside.ts` (+ test), `tools/git/index.ts`.
- Move the git tool's `insideRepo` to `resolveInside(root, rel)`.
- The git tool's tests still pass unchanged.

### Task 2: Matching (D5)
**Files:** `tools/todos/match.ts` (+ test).
- `matchLine(line, tags)` returns `{ tag, text, owner } | null`.
- Tests cover every comment style, the non-matches, the owner, text capping, and closing markers being stripped.

### Task 3: File lists (D2, D3)
**Files:** `tools/todos/files.ts` (+ test).
- `parseLsFiles(stdout, truncated)`.
- `walkFiles(dir, { maxFiles })` uses tinyglobby, the skip list and the root `.gitignore` through `ignore`.
- `listFiles(ctx)` tries git, then the walk, and reports the source.

### Task 4: Scanner (D4)
**Files:** `tools/todos/scan.ts` (+ test).
- `scanFiles(dir, files, tags, { limits, now })` skips binary files (by extension and NUL) and big files, reads 16 at a time, and enforces the match, file and time limits.
- Results are sorted by path, then line.

### Task 5: Contract and settings (D6, contract sketch)
**Files:** `shared/tools/todos/contract.ts`, `shared/tools/index.ts`, icon `list-todo`.

### Task 6: Tool main (D7–D9)
**Files:** `tools/todos/index.ts` (+ test), wiring.
- **Methods:** `results`, `scan` (one at a time per package; concurrent calls share it), `openFile`, `getTags` and `setTags` (changing the tags clears the cache).
- **Lifecycle:** `forgetProject` drops the cache.
- **Logging:** the logger gets counts only.

### Task 7: Integration (real git)
**Files:** `tools/todos/todos.integration.test.ts`.
- A gitignored file's TODO is absent; an untracked file's TODO is present.

## Part B: Renderer

### Task 8: Hook (D7)
**Files:** `use-todos.ts` (+ test).
- `useTodos(projectId)` returns the cached result and starts the first scan when there is none.
- Refresh runs a new scan.

### Task 9: Overview card (D10)
**Files:** `OverviewCard.tsx` (+ test).

### Task 10: Panel (D11)
**Files:** `Panel.tsx` (+ test), `index.ts`, `registry.ts`.
- `fullHeight`, with a root of `h-full min-h-0 overflow-y-auto` and no outer padding.
- The list is virtualised above 200 rows.

## Part C: Ship

### Task 11: End-to-end
**Files:** `e2e/todos.spec.ts`, fixture `e2e/fixtures/todo-app`. Add TODOs to `panel-layout.spec.ts`.

### Task 12: Docs and version (D12)
**Files:** `package.json` (1.4.0), README, CLAUDE.md gotcha, HANDOFF.

### Task 13: Verification and review
- Lint, typecheck, test, build and all e2e under `xvfb-run`.
- Screenshots.
- A self-review against the privacy rules.
- PR, with CI green on both OSes.
- Stop for the owner.
