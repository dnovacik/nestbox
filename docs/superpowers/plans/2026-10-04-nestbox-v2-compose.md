# NestBox v2 (Docker Compose) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-compose-design.md` (decisions D1–D13).
> Branch: `v2-compose` from `main` (after v1.5.0). It is one PR, released as v1.6.0 once CI is green on both OSes and the owner approves.
> Every task is TDD: the failing Vitest test first, then the code, then `pnpm typecheck && pnpm lint && pnpm test`. Commits are conventional and carry the session trailer.

**Goal.** A project with a compose file gets a Compose tab and card: services with their state and ports, Up/Stop/Restart per service or for the whole stack, Down after a confirmation, and one service's logs in the log viewer.

**New dependencies.** None.

---

## Part A: Main

### Task 1: Parsing (D3, D7)
**Files:** `tools/compose/parse.ts` (+ test).
- `parseServices(stdout)` for `config --services`.
- `parsePs(stdout)` accepts a JSON array or JSON lines, and keeps only service, state, health, exit code and publishers.
- `servicePorts(publishers)` drops port 0 and IPv4/IPv6 duplicates.
- `mergeServices(names, containers)` adds `not-created` for services without a container.

### Task 2: Errors (D4)
**Files:** `tools/compose/errors.ts` (+ test).
- `classifyFailure(stderr)` returns `daemon-down` or `failed`; the stderr text itself is never kept.

### Task 3: Contract (D1, sketch)
**Files:** `shared/tools/compose/contract.ts`, registration, the `container` icon.
- `SERVICE_NAME` regex; `appliesTo` is `p.dockerCompose !== null`.

### Task 4: Runner (D2, D5, D6)
**Files:** `tools/compose/runner.ts` (+ test, with a fake `spawnCommand` built from an `EventEmitter` child).
- `createComposeRunner({ platform, logger })`, per package:
  - `action(name, service?)`: one at a time (CONFLICT); 10-minute timeout; output into the Actions `BatchedLog`.
  - `follow(service)` and `unfollow()`: at most one follower; the buffer is cleared on a switch; an exit adds the "■ log stream ended" line.
  - `dispose()` and `forget(rootId)`.

### Task 5: Tool main (D1–D11)
**Files:** `tools/compose/index.ts` (+ test), wired in `tools/index.ts` and `main/index.ts`.
- `status` (docker missing, daemon down, invalid, ok), cached for 1 s.
- `up`, `stop`, `restart`, `down`, `follow`, `unfollow`, `getLogs`, `clearLogs`.
- Service names validated against the current list.
- Events: `changed` after actions, `logs` from the buffers.
- Logs: command name, exit code and duration only.

## Part B: Renderer

### Task 6: Hooks
**Files:** `use-compose.ts` (+ test).
- `useComposeStatus` polls every 3 s while mounted and refetches on `changed`.
- Mutations for the actions.
- `composeLogSource(projectId, source)`.

### Task 7: Overview card (D8)
**Files:** `OverviewCard.tsx` (+ test).

### Task 8: Panel (D9)
**Files:** `Panel.tsx` (+ test), `index.ts`, registry (`fullHeight`).
- The service rows; the Down confirmation dialog; the log selector, which follows a service on pick and unfollows on unmount.

## Part C: Ship

### Task 9: End-to-end
**Files:** `e2e/compose.spec.ts`, the fixture `e2e/fixtures/compose-app` (a `compose.yaml` with `db` and `web`), and `e2e/fake-docker/` (`docker.js` plus `docker.cmd`), put first on `PATH` through `launch(project, { env })`.
- The card shows "0 of 2 running".
- Up all turns both running.
- Stopping `web` from the panel leaves "1 of 2".
- Logs for `db` show the fake log lines.
- Add the Compose tab to `panel-layout.spec.ts`.

### Task 10: Docs and version (D13)
**Files:** `package.json` (1.6.0), README, the CLAUDE.md gotcha, HANDOFF.

### Task 11: Verification and review
- Run lint, typecheck, test, build and all e2e.
- Take screenshots.
- Self-review for privacy: no env, labels or Docker error text in results or logs.
- Open the PR, get CI green, then stop for the owner.
