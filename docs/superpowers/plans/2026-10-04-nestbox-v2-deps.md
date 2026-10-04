# NestBox v2 (Dependency health) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-deps-design.md` (decisions D1–D11).
> Branch: `v2-deps`, stacked on `v2-node-check`. One PR, released as v1.12.0 after 1.11.0.
> TDD as usual; conventional commits with the session trailer.

## Main
1. Contract `deps` (shapes, methods `results`, `check`, `copyUpdateCommand`, event `changed`) and `depsSchedule` in app settings.
2. `tools/deps/parse.ts`: npm, pnpm, Yarn 1, Yarn 2+ and Bun parsers, with real outputs as fixtures (+ tests).
3. `tools/deps/fallback.ts`: installed versions plus registry through the manager (+ tests).
4. `tools/deps/check.ts`: run a package's adapter, merge into rows (+ tests). `run.ts`: spawn and collect.
5. `tools/deps/cache.ts`: the userData file (+ tests).
6. `tools/deps/index.ts`: the tool (check, roll-up, CONFLICT, copy) (+ tests).
7. `tools/deps/scheduler.ts` plus the core channels `deps:overview` and `deps:checkAll`; wiring in `index.ts`.

## Renderer
8. Card and tab.
9. Sidebar entry and the Dependencies page; the schedule in Settings.

## Ship
10. End-to-end with `e2e/fixtures/fake-npm` and a `deps-app` fixture.
11. README, CLAUDE.md, HANDOFF; version 1.12.0.
12. Verification, PR (base `v2-node-check`), CI green, stop for the owner.
