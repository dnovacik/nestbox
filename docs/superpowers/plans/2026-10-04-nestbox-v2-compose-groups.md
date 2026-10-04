# NestBox v2 (Compose in run groups) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-compose-groups-design.md` (decisions D1–D10).
> Branch: `v2-compose-groups`, stacked on `v2-portfolio`. One PR, released as v1.10.0 after 1.9.0.
> TDD as usual; conventional commits with the session trailer.

## Main
1. `shared/types.ts`: `SERVICE_NAME` moves here (the compose contract re-exports it). Add `RunGroupComposeSchema` and `compose` on `RunGroupSchema` with the default `[]`.
2. Compose: `runAction(name, services[], { wait })` builds the argv. The contract's `up`/`stop` take `services`, and `up` takes `wait`. Unknown services are filtered out, and none left means NOT_FOUND.
3. Scripts tool: a `compose` dependency. `startRunGroup` runs compose first and returns `compose: ComposeStep[]`; `stopRunGroup` stops compose services; `saveRunGroup` refuses an empty group. Wiring goes in `index.ts`.

## Renderer
4. The editor's Compose section, the line summary, Start/Stop for compose-only groups, the toast for failed steps.

## Ship
5. End-to-end: a fixture with a compose file plus a script, using the fake docker.
6. Docs: README, CLAUDE.md, HANDOFF; `package.json` 1.10.0.
7. Verification, PR (base `v2-portfolio`), CI green, stop for the owner.
