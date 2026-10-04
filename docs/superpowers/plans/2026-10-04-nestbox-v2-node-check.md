# NestBox v2 (Node version check) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-node-check-design.md` (decisions D1–D12).
> Branch: `v2-node-check`, stacked on `v2-compose-groups`. One PR, released as v1.11.0 after 1.10.0.
> TDD as usual; conventional commits with the session trailer.

## Main
1. `semver` dependency. `shared/tools/node/versions.ts`: `parseRequirement(source, text)`, `ltsMajor`, `conflicts(sources)`, `parsePackageManager(field)`, `nodeStatus(...)` (+ tests).
2. `execCommand` gains `env?` (extra variables) on both adapters.
3. Contract `node`: definition (`appliesTo: packageJson !== null`, settings `{ fnm }`), `status`, `refresh`, `setFnm`, `startAdvice`.
4. `tools/node/index.ts`: read the sources (package, then root), run `node --version` and `<pm> --version` (Corepack offline), detect the version manager, 30 s cache, fnm resolution cached per version.
5. Scripts and processes: `StartRequest` gains `warning` and `pathPrepend`; `ProcessSummary.warning`; the scripts tool asks `node.startAdvice` (3 s cap) before each start; wiring goes in `index.ts`.

## Renderer
6. Overview card, the Node tab, the amber badge on script rows.

## Ship
7. End-to-end with a `node-app` fixture (`.nvmrc` `1`).
8. Spec section (both tools and the network exception for Dependency health), README, CLAUDE.md, HANDOFF; version 1.11.0.
9. Verification, PR (base `v2-compose-groups`), CI green, stop for the owner.
