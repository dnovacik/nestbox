# NestBox v2 (Health checks) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-health-design.md` (decisions D1–D11).
> Branch: `v2-health` from `main` (after v1.4.0). It is one PR, released as v1.5.0 once CI is green on both OSes and the owner approves.
> Every task is TDD: the failing Vitest test first, then the code, then `pnpm typecheck && pnpm lint && pnpm test`. Commits are conventional and carry the session trailer.

**Goal.** While a project's scripts run, NestBox pings its health URLs. The overview shows a dot per check, and a desktop notification says when one goes red.

**New dependencies.** None (`node:http`/`https`).

---

## Part A: Main

### Task 1: URLs (D2, D3)
**Files:** `tools/health/url.ts` (+ test).
- `HttpUrlSchema` accepts http(s) only, with no credentials and at most 2,000 characters.
- `describeHttpUrl` keeps the origin and drops the credentials and the query string.
- `envCheckUrl(value, path)` returns either the URL or a `config` reason.

### Task 2: Request (D4)
**Files:** `tools/health/check.ts` (+ test, against real local `http` servers).
- `checkUrl(url, { timeoutMs, expect })` covers: 2xx and 3xx, `expect`, no redirect following, headers only, timeout, refused, and loopback TLS.

### Task 3: Contract and settings (D2, sketch)
**Files:** `shared/tools/health/contract.ts`, registration, the `heart-pulse` icon.

### Task 4: Scheduler (D5, D6)
**Files:** `tools/health/scheduler.ts` (+ test, fake timers).
- `createHealthScheduler({ run, now, timers })` works per package.
- `setLive(packageId, live)` starts checks 2 s after going live, then repeats every interval; when not live they go idle.
- `checkNow(packageId)` runs a package's checks at once; `update(packageId, checks, interval)` re-reads them.
- Transitions are reported to an `onResult` callback, which decides when to notify.

### Task 5: Tool main (D1–D8)
**Files:** `tools/health/index.ts` (+ test), wired in `tools/index.ts` and `main/index.ts`.
- **Methods:** `status`, `addCheck`, `removeCheck`, `setOptions` and `checkNow`.
- **Process events:** the live state follows the running scripts.
- **Notify rules:**
  - only on ok→fail;
  - not on a first failure;
  - not when `notify` is off.
- **Events:** `changed`, throttled.
- **Logging:** no URLs in the log.
- **Wiring:** `main/index.ts` sends the Electron `Notification` and turns its click into `app:navigate` to the Health tab.

## Part B: Renderer

### Task 6: Hook
**Files:** `use-health.ts` (+ test).
- `useHealth(projectId)` refetches on `changed`.
- Mutations for add, remove, options and Check now.

### Task 7: Overview card (D9)
**Files:** `OverviewCard.tsx` (+ test).

### Task 8: Panel (D10)
**Files:** `Panel.tsx` (+ test), `index.ts`, registry (`fullHeight`, root `h-full min-h-0 overflow-y-auto`).

## Part C: Ship

### Task 9: End-to-end
**Files:** `e2e/health.spec.ts` and the fixture `e2e/fixtures/health-app`, whose script is `node server.js` listening on `PORT` from `.env`.
- Add the suggested check, start the script, and the card turns green.
- Stop the script, and the card turns grey.
- Add the Health tab to `panel-layout.spec.ts`.

### Task 10: Docs and version (D11)
**Files:** `package.json` (1.5.0), README, the CLAUDE.md gotcha, HANDOFF.

### Task 11: Verification and review
- Run lint, typecheck, test, build and all e2e.
- Check screenshots.
- Self-review for privacy (no env values or URLs in the logs).
- Open the PR, get CI green, then stop for the owner.
