# NestBox v2 (Database panel) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-database-design.md` (decisions are referenced as D1…D14).
> Branch: `v2-database` from `main` (after v1.2.1). One PR, released as v1.3.0 once CI is green on both OSes and the owner approves.
> Every task is TDD: the failing Vitest test goes next to the source first, then the code, then `pnpm typecheck && pnpm lint && pnpm test`. Commits are conventional and carry the session trailer.

**Goal.** Each package that has a Prisma schema or env files gets a Database tab and card. They show where `DATABASE_URL` points (with no secrets), whether the server answers, whether the login works, and one-click Prisma commands.

**New dependencies.** None. Prisma is the project's own; a missing Prisma install is reported, never downloaded.

---

## Part A: Main

### Task 1: URL description (D4)
**Files:** `tools/database/url.ts` (+ test).
- `describeUrl(raw, schemaDir)` returns a `DbTarget`.
- Covers every provider in D5, `postgres://` as an alias, IPv6 `[::1]`, encoded passwords and query strings, `file:` relative and absolute, and garbage input (provider `unknown`).
- One test asserts `s3cr3t` appears nowhere in any output.

### Task 2: Schema datasource and the value (D2, D3)
**Files:** `tools/database/schema.ts`, `tools/database/source.ts` (+ tests).
- `readDatasource(schemaPath)` returns `{ provider, env: string | null, literal: boolean }` (a file or a `schema/` folder).
- `findUrl(dir, variable, files)` reads `.env`, then `prisma/.env`, and returns `{ value, source } | null`.
- The value is returned only to the tool and never put into an output schema.

### Task 3: Reachability (D5)
**Files:** `tools/database/reach.ts` (+ test). `checkReachable(target, { connect, exists, timeoutMs })`: the unit tests use fakes; the integration-style cases use a real local server, a closed port and a `.invalid` host.

### Task 4: Prisma commands and Test login (D6, D7)
**Files:** `tools/database/prisma.ts` (+ test).
- `prismaCommand(pm, args)` builds `{ command, args }` for each package manager.
- `loginMessage(code)` maps the P-codes.
- `firstPrismaCode(output)` extracts the first error code from Prisma's output.

### Task 5: Contract and registration (D1, contract sketch)
**Files:** `shared/tools/database/contract.ts`, `shared/tools/index.ts`, `renderer/tools/icons.ts` (`database`).

### Task 6: Tool main (D8–D11, D13)
**Files:** `tools/database/index.ts` (+ test), wiring in `tools/index.ts` and `main/index.ts`.
- **status**
- **testLogin**
- **run**, with a lock per package
- **stop**
- **migrateDev** (`openTerminal`)
- **startStudio**, with its port, one per package
- **getLogs** and **clearLogs**
- **dispose** and **forgetProject**, which kill commands and Studio

The tests use a fake platform and fake children, and the logger receives no URL.

## Part B: Renderer

### Task 7: Hook (D11)
**Files:** `renderer/tools/database/use-database.ts` (+ test). The status query is refetched on `focus`, on env `changed` and on database `changed`. The mutations show their errors in a toast.

### Task 8: Overview card (D12)
**Files:** `OverviewCard.tsx` (+ test): reachable, refused, not checked, missing, and Studio running.

### Task 9: Panel (D4–D10)
**Files:** `Panel.tsx` (+ test), `index.ts`, `registry.ts` (`fullHeight`; its root is `h-full min-h-0`, with no outer padding).
- The target summary, with a Reachability row and the Test login result.
- The Prisma buttons: Status, Generate, Migrate dev (terminal) and Studio (start, stop and open).
- The log, drawn with `LogView`.
- Empty and missing states.

## Part C: Ship

### Task 10: End-to-end
**Files:** `e2e/database.spec.ts`, a fixture `e2e/fixtures/prisma-app` (schema only, no `node_modules`).
- The test starts a TCP server and writes a `.env` with its port.
- The card shows the target and Reachable; after the server closes and the window refocuses, it shows Refused.
- `panel-layout.spec.ts` gains the Database tab.

### Task 11: Docs and version (D14)
**Files:** `package.json` (1.3.0), README (the tools table and roadmap), CLAUDE.md (a Database tool gotcha), HANDOFF.

### Task 12: Verification and review
- Run lint, typecheck, test, build and e2e under `xvfb-run`.
- Take screenshots.
- Review my own diff against the security rules (the URL never logged or sent).
- Open the PR, get CI green on both OSes, then stop for the owner's test.
