# NestBox v2 (Mock API) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-mock-api-design.md` (decisions D1–D13).
> Branch: `v2-mock-api` from `main` (after v1.6.0). It is one PR, released as v1.7.0 once CI is green on both OSes and the owner approves.
> Every task is TDD: the failing Vitest test first, then the code, then `pnpm typecheck && pnpm lint && pnpm test`. Commits are conventional and carry the session trailer.

**Goal.** Define JSON routes in the UI and run them on a local port, with per-route and global delay and failure switches, and see every request in a log.

**New dependencies.** None (`node:http`).

---

## Part A: Main

### Task 1: Contract and schema (D2, D3)
**Files:** `shared/tools/mock/contract.ts` (+ test), registration, the `braces` icon.
- The route schema with the header rules, the size caps and JSON-body validation; package settings; the methods and events.

### Task 2: Paths (D4)
**Files:** `tools/mock/paths.ts` (+ test).
- `compilePath(pattern)` and `matchRoute(routes, method, path)`, returning `{ route, params }` or null.

### Task 3: Placeholders (D5)
**Files:** `shared/tools/mock/template.ts` (+ test). It is shared, because the renderer's editor validates with it too.
- `renderBody(body, { params, query }, contentType)` and `checkJsonBody(body)`.

### Task 4: Handler (D6, D7, D8)
**Files:** `tools/mock/handler.ts` (+ test, against a real `http` server on port 0).
- `createMockHandler({ routes(), options(), log, now })`, which handles the Host check, CORS, preflight, the body cap, delay, fail, 404 and the response headers.

### Task 5: Tool main (D2, D6, D9)
**Files:** `tools/mock/index.ts` (+ test), wired in `tools/index.ts` and `main/index.ts`.
- `config`, `saveRoute`, `deleteRoute`, `moveRoute`, `setOptions`, `status`, `start`, `stop`, `nextFreePort`, `getLogs`, `clearLogs`.
- Dispose and `forgetProject`.
- `firstFreePort` and `isPortFree` move from `static/net.ts` to a shared `tools/net.ts`.

## Part B: Renderer

### Task 6: Hooks
**Files:** `use-mock.ts` (+ test).

### Task 7: Overview card (D10)
**Files:** `OverviewCard.tsx` (+ test).

### Task 8: Panel and route editor (D11)
**Files:** `Panel.tsx`, `RouteEditor.tsx` (+ tests), `index.ts`, registry (`fullHeight`).

## Part C: Ship

### Task 9: End-to-end
**Files:** `e2e/mock.spec.ts`.
- Add a route, start the server, fetch from the test, see the log line, then check fail and 404.
- Add the Mock API tab to `panel-layout.spec.ts`.

### Task 10: Docs and version (D13)
**Files:** `package.json` (1.7.0), README, the CLAUDE.md gotcha, HANDOFF.

### Task 11: Verification and review
- Run lint, typecheck, test, build and all e2e.
- Take screenshots.
- Self-review: the Host check, the body cap, no request data kept.
- Open the PR, get CI green, then stop for the owner.
