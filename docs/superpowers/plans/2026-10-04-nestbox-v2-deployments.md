# NestBox v2 (Deployments) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-deployments-design.md` (decisions D1–D12).
> Branch: `v2-deployments`, stacked on `v2-light-theme`. One PR, released as v1.14.0 after 1.13.0.
> TDD as usual; conventional commits with the session trailer.

## Main
1. Detection: `DetectedProject.deploy` from file names (+ tests, fixtures updated).
2. Contract `deploy`: platforms, local status, deployments, deploy (production needs `confirmed`), cancel, logs; events `changed`, `logs`.
3. `tools/deploy/config.ts`: Vercel/Netlify link files, wrangler TOML/JSONC, `fly.toml` (+ tests).
4. `tools/deploy/cli.ts`: local CLI through the package manager, else global, else missing; login/link commands (+ tests).
5. `tools/deploy/parse.ts`: Vercel, Workers, Pages, Fly listings and Netlify status; stderr classification; URL from deploy output (+ tests with fixtures).
6. `tools/deploy/index.ts`: the tool (status, deployments, deploy with lock/timeout/cancel, BatchedLog, login/link terminals) (+ tests). Wire in `createMainTools`.

## Renderer
7. Hook, card and tab (platform sections, deployments table, confirm dialog, log). Registry and icon.

## Ship
8. End-to-end with `e2e/fixtures/fake-vercel` and a `deploy-app` fixture.
9. README, CLAUDE.md, HANDOFF, spec; version 1.14.0.
10. Verification, PR (base `v2-light-theme`), CI green, stop for the owner.
