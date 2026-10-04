# NestBox v2 (Env vs production) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-env-compare-design.md` (D1–D7).
> Branch: `v2-env-compare`, stacked on `v2-deployments`. Released as v1.15.0 after 1.14.0.

1. Contract: `PlatformStatus.environments`, `envFiles`; method `envCompare`.
2. `config.ts`: TOML table keys, Workers environments and vars, Fly `[env]` (+ tests).
3. `env-parse.ts`: Vercel, Netlify, Workers, Pages and Fly key parsers (+ fixtures, values never out).
4. Tool: `envCompare` with the env file access (+ tests); wiring.
5. Renderer: the Env row in each platform section (+ tests).
6. End-to-end with the fake Vercel's `env ls`; docs; version 1.15.0; PR (base `v2-deployments`).
