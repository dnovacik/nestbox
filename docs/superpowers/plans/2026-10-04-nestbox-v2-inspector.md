# NestBox v2 (Request inspector) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-04-nestbox-v2-inspector-design.md` (decisions D1–D13).
> Branch: `v2-inspector` from `main` (after v1.7.0). It is one PR, released as v1.8.0 once CI is green on both OSes and the owner approves.
> Every task is TDD: the failing Vitest test first, then the code, then `pnpm typecheck && pnpm lint && pnpm test`. Commits are conventional and carry the session trailer.

**Goal.** Put NestBox between a client and the local API, record every request and response in memory, and resend any of them, as recorded or edited.

**New dependencies.** None (`node:http`, `node:zlib`).

---

## Part A: Main

### Task 1: Contract (D1, D2, sketch)
**Files:** `shared/tools/inspector/contract.ts` (+ test), registration, the `radar` icon.
- The `LocalUrl` schema, the settings, summaries, sides and methods.

### Task 2: Recording helpers (D4, D5, D6)
**Files:** `tools/inspector/record.ts` (+ test).
- `Capture` (a byte-capped buffer), `isMasked(name)`, `toSide(headers, capture, { encoding })`, which decodes gzip, deflate and br, and the ring.

### Task 3: Proxy handler (D3, D4)
**Files:** `tools/inspector/proxy.ts` (+ test, real servers).
- `createProxyHandler({ target(), onEntry, now })` and `sendRequest(target, request)`, which replay and send share.

### Task 4: curl (D8)
**Files:** `tools/inspector/curl.ts` (+ test).

### Task 5: Tool main (D2, D7, D9–D10)
**Files:** `tools/inspector/index.ts` (+ test), wired in `tools/index.ts` and `main/index.ts` (with the clipboard).
- `config`, `setOptions`, `status`, `start`, `stop`, `nextFreePort`, `list`, `get`, `reveal`, `replay`, `send`, `copyCurl`, `clear`.

## Part B: Renderer

### Task 6: Hooks
**Files:** `use-inspector.ts` (+ test).

### Task 7: Overview card (D11)
**Files:** `OverviewCard.tsx` (+ test).

### Task 8: Panel, detail and send dialog (D12)
**Files:** `Panel.tsx`, `EntryDetail.tsx`, `SendDialog.tsx` (+ tests), `index.ts`, registry (`fullHeight`).

## Part C: Ship

### Task 9: End-to-end
**Files:** `e2e/inspector.spec.ts` and the fixture `e2e/fixtures/echo-api`.
- Proxy a request with an `Authorization` header, see it masked, replay it.
- Add the Inspector tab to `panel-layout.spec.ts`.

### Task 10: Docs and version (D13)
**Files:** `package.json` (1.8.0), README (the roadmap now ends with the tunnel follow-up), the CLAUDE.md gotcha, HANDOFF.

### Task 11: Verification and review
- Run lint, typecheck, test, build and all e2e.
- Take screenshots.
- Self-review: the Host check, the size caps, masking end to end, no recordings in logs.
- Open the PR, get CI green, then stop for the owner.
