# NestBox v2 (Inspector tunnel) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-tunnel-design.md` (decisions D1–D9).
> Branch: `v2-tunnel`, stacked on `v2-followups` (1.8.0). One PR, released as v1.9.0 after 1.8.0.
> TDD as usual; conventional commits with the session trailer.

## Main
1. `tools/inspector/tunnel.ts` (+ test): `parseTunnelUrl(text)` and `createTunnel({ platform, logger, port, onChange })`, which handles the argv, starting → on, the timeout, an exit, stop, and output never logged.
2. Contract: `TunnelSchema`, `cloudflared` in the status, `tunnelStart`, `tunnelStop`, `copyTunnelUrl`; `cf-connecting-ip` masked.
3. Tool: one tunnel per package; refused unless the inspector runs and cloudflared exists; stopping the inspector, dispose and removal stop it.

## Renderer
4. The Share publicly button and confirmation, the address with Copy/Open/Stop, errors, the install hint; the "tunnel" badge in the list; "shared publicly" on the card.

## Ship
5. End-to-end with `e2e/fixtures/fake-cloudflared` (`cloudflared.js`, `cloudflared.cmd`, `cloudflared`).
6. Docs: README, CLAUDE.md, HANDOFF; `package.json` 1.9.0.
7. Verification, PR (base `v2-followups`), CI green, stop for the owner.
