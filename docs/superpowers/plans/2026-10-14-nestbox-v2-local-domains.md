# Local Domains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach every NestBox project at `https://<name>.localhost`, routed to whatever port its dev server listens on, over HTTPS that browsers trust.

**Architecture:** A core service in main (`src/main/domains/`), with these parts:

- a pure **name/router** layer: projects + port attribution + settings → a route table;
- a **proxy**: `node:http`/`node:https` servers on loopback that stream requests, pass WebSocket upgrades through, and choose a certificate per host name while the connection opens (SNI);
- a **local CA**: name-constrained to `.localhost`, signing a leaf certificate per host;
- **adapter helpers** that add the root to the user's trust store.

Settings live in `AppSettings.domains`; the renderer talks to the service through core `domains:*` channels.

**Tech Stack:** Electron 44 main (Node 22+), `node:http`/`node:https`/`node:net`/`node:tls`, `@peculiar/x509` + `@peculiar/asn1-x509` + `@peculiar/asn1-schema` (new direct dependencies, already installed through `selfsigned`), Zod, React + TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-nestbox-v2-local-domains-design.md`

## Global Constraints

- pnpm only. TypeScript strict with `noUncheckedIndexedAccess`; no `any`.
- No `process.platform` outside `src/main/platform/` (lint enforces it).
- Renderer colours come from tokens in `src/renderer/styles/globals.css` only (lint rejects hex elsewhere). The HTML pages the proxy serves are main-process strings, not renderer code, but must not use hex literals either: use `rgb(...)` values.
- Logs carry names, ports, route sources, server states, error codes and trust results. **Never** paths, queries, headers, certificates or keys. `Logger` fields are primitives only.
- IPC: every channel has a Zod input and output in `src/shared/channels.ts`, its name in `src/shared/ipc-names.ts`, a handler in `src/main/ipc/core-handlers.ts`, and a method in `src/shared/client.ts`. Error codes: `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `FORBIDDEN`, `INTERNAL`.
- Defaults (spec): `enabled: false`, `httpPort: 80`, `httpsPort: 443`, no automatic fallback port, bind `127.0.0.1` and `::1` only.
- The root CA is name-constrained to the DNS subtree `localhost` (a critical extension), valid 10 years, RSA 2048 with SHA-256. Leaves are valid 365 days and renewed within 30 days of expiry.
- A request whose `Host` isn't `<label>(.<label>)*.localhost` gets 403; an unknown `.localhost` name gets 404; a known name with no port gets the not-running page (503); a refused or reset target gets 502.
- The `Host` header is kept, unless the project's `rewriteHost` is on; then it is `localhost:<port>`. `X-Forwarded-Host`/`-Proto`/`-For` are always added; hop-by-hop headers are dropped.
- TDD: write the failing Vitest test first, next to the source. Small conventional commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Format only your own new files with `pnpm prettier --write <files>`. For existing files, run Prettier only if `git show HEAD:<file> | pnpm prettier --check --stdin-filepath <file>` passes (the repo isn't Prettier-clean).

## Deviations from the spec, decided while planning

1. **Name constraints:** `selfsigned` skips extensions it doesn't know, so the root is built with `@peculiar/x509` plus `@peculiar/asn1-x509`'s `NameConstraints`. A spike on 2026-10-14 confirmed it: Node's TLS accepted a `shop.localhost` leaf and rejected an `example.com` leaf from the same root with "permitted subtree violation".
2. **Leaves are per exact host name** (`storybook.shop.localhost` gets its own), made on demand through SNI. There's no `*.name` wildcard: per-host leaves cover every sub-domain the router makes, without wildcard rules.
3. **One confirmation, not two:** the first-run explanation **is** the native confirmation main shows in `domains:trustCa` (its `detail` explains the CA and the `.localhost` limit). The renderer doesn't add a second dialog.
4. **"First running script"** means the earliest-started running script of the package (`ProcessManager.list()` order), not the Scripts list's order: that order lives in the Scripts tool and would need a tool call per rebuild.
5. **macOS trust results:** `security`'s errors go to stderr, which `CommandRunner.exec` doesn't return, so on macOS a cancel and a failure are both `failed`. Windows tells them apart (`0x800704c7` → `cancelled`).
6. **Firefox:** Mozilla documents that Firefox reads third-party roots from the OS store on Windows and macOS by default, but on Windows it may read only the machine store, and NestBox adds the root to the user store. Settings carries a one-line hint (Firefox: Settings → Privacy & Security → Certificates → "Allow Firefox to automatically trust third-party root certificates you install"), and Task 12 has a manual check.
7. **E2E trust stub:** `NESTBOX_FAKE_TRUST=1` (honoured only when unpackaged, like `NESTBOX_USER_DATA_DIR`) replaces the adapter's trust commands with no-ops that answer `trusted`/`removed`, so tests never touch a real trust store.

## Review Focus

Spec-implied inputs no task tests by default, most likely to bite first. Each one's test is added to the owning task:

1. **Host header spelling:** `SHOP.Localhost`, a trailing dot (`shop.localhost.`), with a port (`shop.localhost:443`), IPv6 literals. Expect normalisation to the same route; IP literals get 403. (Task 4)
2. **A route that points back at the proxy** (a script listening on the proxy's own port, or port 0). Expect it ignored, never a request loop. (Task 4)
3. **The ports setting changed while connections are open**, including WebSockets. Expect the old servers closed, their sockets destroyed, and the new ports bound (or `failed` with a code). (Task 5 and Task 9)
4. **A target that accepts the upgrade TCP connection and then closes** (a dev server restarting during hot reload). Expect both sockets destroyed and no unhandled `error` event crashing main. (Task 6)
5. **A corrupt or partial `domains-ca.json`** (killed mid-write, edited by hand). Expect a regenerated CA, `trust` reset to `none`, and no crash at startup. (Task 7)

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/main/net/forward.ts` (create) | Shared proxy helpers: hop-by-hop list, `hostName`, `isLocalHost`, `proxyRequestHeaders` (raw pairs with `X-Forwarded-*`, Host kept or rewritten) |
| `src/main/tools/inspector/proxy.ts` (modify) | Import the shared helpers instead of its own copies |
| `src/shared/domains.ts` (create) | Zod: `DomainsSettingsSchema`, `ServerStateSchema`, `RouteSchema`, `DomainsStatusSchema`, channel inputs, `TrustResult` |
| `src/shared/types.ts` (modify) | `AppSettings.domains` with a default |
| `src/main/domains/names.ts` (create) | `toLabel`, `assignNames` (labels, workspace names, overrides, clashes) |
| `src/main/domains/router.ts` (create) | `buildRoutes` (pure), `resolveHost` (Host → `Resolution`) |
| `src/main/domains/pages.ts` (create) | The 403/404/502/503 HTML pages |
| `src/main/domains/proxy.ts` (create) | Servers, forwarding, redirect, upgrades, bind states |
| `src/main/domains/ca.ts` (create) | Root and leaf generation (`@peculiar/x509`), storage, renewal |
| `src/main/platform/adapter.ts`, `win32.ts`, `darwin.ts` (modify) | `trustRootCa`, `untrustRootCa` |
| `src/main/domains/service.ts` (create) | Orchestration: settings, rebuild triggers, servers, status, trust flow |
| `src/shared/channels.ts`, `ipc-names.ts`, `client.ts` (modify) | `domains:*` channels and the `domains:changed` event |
| `src/main/ipc/core-handlers.ts`, `src/main/index.ts` (modify) | Handlers, wiring, quit |
| `src/renderer/domains/use-domains.ts` (create) | `useDomainsStatus`, `useDomainsActions` |
| `src/renderer/domains/DomainsSettings.tsx` (create) | The Settings section |
| `src/renderer/domains/DomainLink.tsx`, `LocalDomainDialog.tsx` (create) | The header link, the project dialog |
| `src/renderer/app/SettingsDialog.tsx`, `ProjectHeader.tsx`, `palette-entries.ts`, `CommandPalette.tsx`, `src/renderer/ports/PortsPage.tsx` (modify) | Wiring the UI |
| `e2e/domains.spec.ts` (create) | End to end |

---

### Task 1: Shared forwarding helpers and dependencies

**Files:**
- Create: `src/main/net/forward.ts`, `src/main/net/forward.test.ts`
- Modify: `src/main/tools/inspector/proxy.ts` (replace its `HOP_BY_HOP`, `LOCAL_HOSTS`, `hostName`, `isLocalHost` with imports), `package.json` (dependencies)

**Interfaces:**
- Produces: `HOP_BY_HOP: ReadonlySet<string>`, `hostName(host: string | undefined): string`, `isLocalHost(host: string | undefined): boolean`, `proxyRequestHeaders(raw: readonly string[], opts: { host: string; proto: 'http' | 'https'; remoteAddress: string | undefined; rewriteHostTo: string | null }): string[]` (a flat raw-headers array, like `IncomingMessage.rawHeaders`).

- [ ] **Step 1: Add the dependencies** (versions already in the lockfile through `selfsigned`)

Run: `pnpm add @peculiar/x509@1.14.3 @peculiar/asn1-x509@2.10.0 @peculiar/asn1-schema@2.10.0`
Expected: `package.json` `dependencies` gains the three entries; `pnpm-lock.yaml` changes only in the importers section.

- [ ] **Step 2: Write the failing test** `src/main/net/forward.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { hostName, isLocalHost, proxyRequestHeaders } from './forward';

const pairs = (raw: string[]) => {
  const out: [string, string][] = [];
  for (let i = 0; i < raw.length; i += 2) out.push([raw[i] ?? '', raw[i + 1] ?? '']);
  return out;
};

describe('hostName / isLocalHost', () => {
  it('drops the port and lowercases', () => {
    expect(hostName('Shop.Localhost:443')).toBe('shop.localhost');
    expect(hostName('[::1]:4020')).toBe('[::1]');
    expect(isLocalHost('localhost:3000')).toBe(true);
    expect(isLocalHost('shop.localhost')).toBe(false);
  });
});

describe('proxyRequestHeaders', () => {
  const raw = ['Host', 'shop.localhost', 'Connection', 'keep-alive', 'Cookie', 'a=1', 'Cookie', 'b=2', 'X-Forwarded-For', '10.0.0.9', 'Upgrade', 'websocket'];

  it('keeps Host, drops hop-by-hop headers and adds X-Forwarded-*', () => {
    const out = pairs(proxyRequestHeaders(raw, { host: 'shop.localhost', proto: 'https', remoteAddress: '127.0.0.1', rewriteHostTo: null }));
    expect(out).toEqual([
      ['Host', 'shop.localhost'],
      ['Cookie', 'a=1'],
      ['Cookie', 'b=2'],
      ['X-Forwarded-Host', 'shop.localhost'],
      ['X-Forwarded-Proto', 'https'],
      ['X-Forwarded-For', '10.0.0.9, 127.0.0.1'],
    ]);
  });

  it('rewrites Host when asked, keeping X-Forwarded-Host as the name', () => {
    const out = pairs(proxyRequestHeaders(raw, { host: 'shop.localhost', proto: 'http', remoteAddress: undefined, rewriteHostTo: 'localhost:3000' }));
    expect(out[0]).toEqual(['Host', 'localhost:3000']);
    expect(out).toContainEqual(['X-Forwarded-Host', 'shop.localhost']);
    expect(out).toContainEqual(['X-Forwarded-For', '10.0.0.9']);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run src/main/net/forward.test.ts`
Expected: FAIL, "Failed to resolve import ./forward".

- [ ] **Step 4: Write `src/main/net/forward.ts`**

```ts
// Helpers shared by NestBox's HTTP proxies (the Inspector and local domains): which headers never travel
// through a proxy, host-name parsing, and the request headers a proxied request carries.

export const HOP_BY_HOP: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORWARDED = new Set(['x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for']);

/** "[::1]:4020" → "[::1]"; "Shop.Localhost:443" → "shop.localhost". */
export function hostName(host: string | undefined): string {
  if (!host) return '';
  const value = host.trim().toLowerCase();
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1);
  return value.split(':')[0] ?? '';
}

export function isLocalHost(host: string | undefined): boolean {
  return LOCAL_HOSTS.has(hostName(host));
}

/**
 * A proxied request's headers as a flat raw list: hop-by-hop headers dropped, Host kept (or rewritten),
 * and X-Forwarded-Host/-Proto/-For set (an incoming X-Forwarded-For is extended, the others replaced).
 */
export function proxyRequestHeaders(
  raw: readonly string[],
  opts: { host: string; proto: 'http' | 'https'; remoteAddress: string | undefined; rewriteHostTo: string | null },
): string[] {
  const out: string[] = [];
  let forwardedFor: string | null = null;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i] ?? '';
    const value = raw[i + 1] ?? '';
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'x-forwarded-for') {
      forwardedFor = forwardedFor === null ? value : `${forwardedFor}, ${value}`;
      continue;
    }
    if (FORWARDED.has(lower)) continue;
    if (lower === 'host') {
      out.push(name, opts.rewriteHostTo ?? value);
      continue;
    }
    out.push(name, value);
  }
  const chain = [forwardedFor, opts.remoteAddress].filter((v): v is string => !!v).join(', ');
  out.push('X-Forwarded-Host', opts.host, 'X-Forwarded-Proto', opts.proto);
  if (chain) out.push('X-Forwarded-For', chain);
  return out;
}
```

- [ ] **Step 5: Point the Inspector at the shared helpers**

In `src/main/tools/inspector/proxy.ts`, delete the local `HOP_BY_HOP` and `LOCAL_HOSTS` constants and the `hostName`/`isLocalHost` functions, and add:

```ts
import { HOP_BY_HOP, hostName, isLocalHost } from '../../net/forward';

export { hostName, isLocalHost };
```

(The re-export keeps `tools/inspector/index.ts` and its tests unchanged.)

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/main/net src/main/tools/inspector`
Expected: PASS (the new tests and every Inspector test).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/main/net src/main/tools/inspector/proxy.ts
git commit -m "refactor(net): share the proxy helpers, add @peculiar/x509 for local domains

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared schemas and the settings default

**Files:**
- Create: `src/shared/domains.ts`, `src/shared/domains.test.ts`
- Modify: `src/shared/types.ts` (`AppSettingsSchema`)

**Interfaces:**
- Produces (all exported from `src/shared/domains.ts`):
  - `LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/`
  - `DomainsSettingsSchema`, `type DomainsSettings`
  - `TRUST_STATES = ['none', 'trusted', 'untrusted'] as const`
  - `ServerStateSchema` (`{ state: 'off' | 'running' | 'failed'; port: number; code: string | null; owner: string | null }`), `type ServerState`
  - `ROUTE_SOURCES = ['main', 'script', 'detected', 'none'] as const`
  - `RouteSchema` (`{ name; projectId; script: string | null; port: number | null; source; rewriteHost: boolean }`), `type Route`
  - `DomainsStatusSchema` (`{ enabled; http: ServerState; https: ServerState; trust; routes: Route[]; clashes: string[] }`), `type DomainsStatus`
  - `DomainsPortsInputSchema`, `DomainsNameInputSchema`, `DomainsRewriteInputSchema`
  - `TrustResultSchema` (`{ result: 'trusted' | 'cancelled' | 'failed' | 'removed' }`), `type TrustResult`

- [ ] **Step 1: Write the failing test** `src/shared/domains.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { AppSettingsSchema } from './types';
import { DomainsPortsInputSchema, DomainsNameInputSchema, LABEL } from './domains';

describe('domains settings', () => {
  it('defaults to off on 80/443 with nothing trusted, so old stores need no migration', () => {
    expect(AppSettingsSchema.parse({}).domains).toEqual({
      enabled: false,
      httpPort: 80,
      httpsPort: 443,
      names: {},
      rewriteHost: {},
      trust: 'none',
    });
  });

  it('refuses equal or out-of-range ports', () => {
    expect(DomainsPortsInputSchema.safeParse({ httpPort: 80, httpsPort: 80 }).success).toBe(false);
    expect(DomainsPortsInputSchema.safeParse({ httpPort: 0, httpsPort: 443 }).success).toBe(false);
    expect(DomainsPortsInputSchema.safeParse({ httpPort: 18080, httpsPort: 18443 }).success).toBe(true);
  });

  it('accepts host labels only as name overrides', () => {
    expect(LABEL.test('shop')).toBe(true);
    expect(LABEL.test('my-shop-2')).toBe(true);
    expect(LABEL.test('-shop')).toBe(false);
    expect(LABEL.test('Shop')).toBe(false);
    expect(DomainsNameInputSchema.safeParse({ projectId: 'p1', label: 'a.b' }).success).toBe(false);
    expect(DomainsNameInputSchema.safeParse({ projectId: 'p1', label: null }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/shared/domains.test.ts`
Expected: FAIL, "Failed to resolve import ./domains".

- [ ] **Step 3: Write `src/shared/domains.ts`**

```ts
// Local domains (v1.30): settings, the status the renderer shows, and the channel inputs.
import { z } from 'zod';

/** One DNS label as NestBox uses it: lowercase letters, digits and inner dashes, 1–63 characters. */
export const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const Port = z.number().int().min(1).max(65_535);
const Id = z.string().min(1).max(512);

export const TRUST_STATES = ['none', 'trusted', 'untrusted'] as const;

export const DomainsSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  httpPort: Port.default(80),
  httpsPort: Port.default(443),
  /** projectId (a workspace package's is <rootId>::<relPath>) → label override. */
  names: z.record(z.string(), z.string().regex(LABEL)).default({}),
  /** projectIds whose Host header is rewritten to localhost:<port>. */
  rewriteHost: z.record(z.string(), z.literal(true)).default({}),
  trust: z.enum(TRUST_STATES).default('none'),
});
export type DomainsSettings = z.infer<typeof DomainsSettingsSchema>;

export const ServerStateSchema = z.object({
  state: z.enum(['off', 'running', 'failed']),
  port: Port,
  /** The bind error's code (EADDRINUSE, EACCES); null otherwise. */
  code: z.string().nullable(),
  /** Who holds the port, when it is taken and known (a process name or "<project> · <script>"). */
  owner: z.string().nullable(),
});
export type ServerState = z.infer<typeof ServerStateSchema>;

export const ROUTE_SOURCES = ['main', 'script', 'detected', 'none'] as const;

export const RouteSchema = z.object({
  /** The full host name, e.g. shop.localhost or storybook.shop.localhost. */
  name: z.string(),
  projectId: z.string(),
  /** The script whose port this is (main or script routes); null for detected or none. */
  script: z.string().nullable(),
  port: Port.nullable(),
  source: z.enum(ROUTE_SOURCES),
  /** The project's Host header is rewritten to localhost:<port> (the Local domain dialog shows it). */
  rewriteHost: z.boolean(),
});
export type Route = z.infer<typeof RouteSchema>;

export const DomainsStatusSchema = z.object({
  enabled: z.boolean(),
  http: ServerStateSchema,
  https: ServerStateSchema,
  trust: z.enum(TRUST_STATES),
  routes: z.array(RouteSchema),
  /** Project ids whose name got a -2, -3, … suffix. */
  clashes: z.array(z.string()),
});
export type DomainsStatus = z.infer<typeof DomainsStatusSchema>;

export const DomainsPortsInputSchema = z
  .strictObject({ httpPort: Port, httpsPort: Port })
  .refine((p) => p.httpPort !== p.httpsPort, 'ports must differ');
export const DomainsNameInputSchema = z.strictObject({ projectId: Id, label: z.string().regex(LABEL).nullable() });
export const DomainsRewriteInputSchema = z.strictObject({ projectId: Id, rewrite: z.boolean() });

export const TrustResultSchema = z.object({ result: z.enum(['trusted', 'cancelled', 'failed', 'removed']) });
export type TrustResult = z.infer<typeof TrustResultSchema>;
```

- [ ] **Step 4: Add the setting** in `src/shared/types.ts` `AppSettingsSchema`, after `toolsChosen`:

```ts
  /** Local domains (v1.30), off until turned on; added with a default, so the store stays at v2. */
  domains: DomainsSettingsSchema.default(() => DomainsSettingsSchema.parse({})),
```

and `import { DomainsSettingsSchema } from './domains';` at the top.

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm vitest run src/shared && pnpm typecheck`
Expected: PASS. If a test compares a whole `AppSettings` object literally, add `domains: DomainsSettingsSchema.parse({})` to its expectation.

- [ ] **Step 6: Commit**

```bash
git add src/shared/domains.ts src/shared/domains.test.ts src/shared/types.ts
git commit -m "feat(domains): settings and status schemas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Names

**Files:**
- Create: `src/main/domains/names.ts`, `src/main/domains/names.test.ts`

**Interfaces:**
- Consumes: `LABEL` (Task 2).
- Produces: `toLabel(text: string): string`; `packageLabel(name: string, relPath: string): string`; `assignNames(projects: readonly NamedProject[], overrides: Readonly<Record<string, string>>): { names: Map<string, string>; clashes: string[] }`, where `NamedProject = { id: string; name: string; workspaces: readonly { id: string; name: string; relPath: string }[] }` and `names` maps a projectId to its full host name (`shop.localhost`, `api.shop.localhost`).

- [ ] **Step 1: Write the failing test** `src/main/domains/names.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { assignNames, packageLabel, toLabel } from './names';

describe('toLabel', () => {
  it('makes a host label from a display name', () => {
    expect(toLabel('My Shop!')).toBe('my-shop');
    expect(toLabel('  --Ünïcode__App--  ')).toBe('n-code-app');
    expect(toLabel('???')).toBe('project');
    expect(toLabel('a'.repeat(80))).toHaveLength(63);
  });
});

describe('packageLabel', () => {
  it('drops an npm scope, else uses the folder', () => {
    expect(packageLabel('@shop/api', 'packages/api')).toBe('api');
    expect(packageLabel('Shop.Core', 'src/Shop.Core')).toBe('shop-core');
    expect(packageLabel('', 'apps/web')).toBe('web');
  });
});

describe('assignNames', () => {
  const shop = { id: 'r1', name: 'Shop', workspaces: [{ id: 'r1::packages/api', name: '@shop/api', relPath: 'packages/api' }] };

  it('names roots and workspace packages under them', () => {
    const { names, clashes } = assignNames([shop], {});
    expect(Object.fromEntries(names)).toEqual({ r1: 'shop.localhost', 'r1::packages/api': 'api.shop.localhost' });
    expect(clashes).toEqual([]);
  });

  it('applies overrides, and numbers clashes in sidebar order', () => {
    const other = { id: 'r2', name: 'shop', workspaces: [] };
    const { names, clashes } = assignNames([shop, other], { 'r1::packages/api': 'backend' });
    expect(names.get('r1::packages/api')).toBe('backend.shop.localhost');
    expect(names.get('r2')).toBe('shop-2.localhost');
    expect(clashes).toEqual(['r2']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/main/domains/names.test.ts`
Expected: FAIL, "Failed to resolve import ./names".

- [ ] **Step 3: Write `src/main/domains/names.ts`**

```ts
// Host names for projects: a root is <label>.localhost, a workspace package <package>.<root>.localhost.
// Labels come from display names (or the user's override) and are unique per level.
import { LABEL } from '@shared/domains';

export interface NamedProject {
  id: string;
  name: string;
  workspaces: readonly { id: string; name: string; relPath: string }[];
}

/** A display name as one DNS label: lowercase [a-z0-9-], no edge or repeated dashes, at most 63. */
export function toLabel(text: string): string {
  const label = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
  return LABEL.test(label) ? label : 'project';
}

/** A workspace package's label: its name without an npm scope, else its folder's last part. */
export function packageLabel(name: string, relPath: string): string {
  const unscoped = name.startsWith('@') ? (name.split('/')[1] ?? '') : name;
  return toLabel(unscoped || relPath.split('/').pop() || '');
}

function unique(label: string, taken: Set<string>): string {
  let candidate = label;
  for (let n = 2; taken.has(candidate); n++) {
    const suffix = `-${n}`;
    candidate = `${label.slice(0, 63 - suffix.length)}${suffix}`;
  }
  taken.add(candidate);
  return candidate;
}

export function assignNames(
  projects: readonly NamedProject[],
  overrides: Readonly<Record<string, string>>,
): { names: Map<string, string>; clashes: string[] } {
  const names = new Map<string, string>();
  const clashes: string[] = [];
  const roots = new Set<string>();
  for (const project of projects) {
    const wanted = overrides[project.id] ?? toLabel(project.name);
    const root = unique(wanted, roots);
    if (root !== wanted) clashes.push(project.id);
    names.set(project.id, `${root}.localhost`);
    const inRoot = new Set<string>();
    for (const ws of project.workspaces) {
      const wsWanted = overrides[ws.id] ?? packageLabel(ws.name, ws.relPath);
      const label = unique(wsWanted, inRoot);
      if (label !== wsWanted) clashes.push(ws.id);
      names.set(ws.id, `${label}.${root}.localhost`);
    }
  }
  return { names, clashes };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/main/domains/names.test.ts`
Expected: PASS. (`'  --Ünïcode__App--  '` → `n-code-app`: the non-ASCII letters become dashes, which are then collapsed.)

- [ ] **Step 5: Commit**

```bash
git add src/main/domains/names.ts src/main/domains/names.test.ts
git commit -m "feat(domains): host names for projects and workspace packages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Router

**Files:**
- Create: `src/main/domains/router.ts`, `src/main/domains/router.test.ts`

**Interfaces:**
- Consumes: `assignNames`, `toLabel`, `NamedProject` (Task 3); `Route` (Task 2); `PortRow` (`@shared/ports`); `ProcessSummary`, `isLive` (`@shared/processes`).
- Produces:
  - `interface RouterInput { projects: readonly NamedProject[]; overrides: Readonly<Record<string, string>>; rewriteHost: Readonly<Record<string, true>>; mainScripts: ReadonlyMap<string, string> /* projectId → main script */; processes: readonly ProcessSummary[]; ports: readonly PortRow[]; detectedPorts: ReadonlyMap<string, number> /* projectId → .env PORT or detected */; ownPorts: readonly number[] }`
  - `interface RouteTable { routes: Route[]; clashes: string[]; byName: ReadonlyMap<string, RouteTarget> }`, with `RouteTarget = Route & { ipv6Only: boolean }`
  - `buildRoutes(input: RouterInput): RouteTable`
  - `type Resolution = { kind: 'forward'; route: RouteTarget; port: number } | { kind: 'not-running'; route: RouteTarget } | { kind: 'unknown'; known: string[] } | { kind: 'forbidden' }`
  - `resolveHost(table: RouteTable, host: string | undefined): Resolution`

- [ ] **Step 1: Write the failing test** `src/main/domains/router.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { PortRow } from '@shared/ports';
import type { ProcessSummary } from '@shared/processes';
import { buildRoutes, resolveHost, type RouterInput } from './router';

const proc = (projectId: string, script: string, startedAt = 1): ProcessSummary =>
  ({ projectId, script, state: 'running', startedAt }) as ProcessSummary;
const port = (n: number, projectId: string, script: string, addresses = ['127.0.0.1']): PortRow => ({
  port: n,
  pid: 100 + n,
  addresses,
  processName: 'node',
  command: null,
  owner: { projectId, script },
});

const base: RouterInput = {
  projects: [{ id: 'r1', name: 'Shop', workspaces: [{ id: 'r1::packages/api', name: '@shop/api', relPath: 'packages/api' }] }],
  overrides: {},
  rewriteHost: {},
  mainScripts: new Map(),
  processes: [],
  ports: [],
  detectedPorts: new Map(),
  ownPorts: [80, 443],
};

describe('buildRoutes', () => {
  it('prefers the main command, then the earliest running script, then the detected port', () => {
    const table = buildRoutes({
      ...base,
      mainScripts: new Map([['r1', 'web']]),
      processes: [proc('r1', 'storybook', 1), proc('r1', 'web', 2), proc('r1::packages/api', 'dev', 3)],
      ports: [port(6006, 'r1', 'storybook'), port(5173, 'r1', 'web'), port(3000, 'r1::packages/api', 'dev')],
    });
    expect(table.routes).toEqual([
      { name: 'shop.localhost', projectId: 'r1', script: 'web', port: 5173, source: 'main', rewriteHost: false },
      { name: 'storybook.shop.localhost', projectId: 'r1', script: 'storybook', port: 6006, source: 'script', rewriteHost: false },
      { name: 'api.shop.localhost', projectId: 'r1::packages/api', script: 'dev', port: 3000, source: 'script', rewriteHost: false },
    ]);
  });

  it('falls back to the detected port, then none', () => {
    const table = buildRoutes({ ...base, detectedPorts: new Map([['r1', 5173]]) });
    expect(table.routes.map((r) => [r.name, r.port, r.source])).toEqual([
      ['shop.localhost', 5173, 'detected'],
      ['api.shop.localhost', null, 'none'],
    ]);
  });

  it("ignores ports that point back at the proxy, or are 0", () => {
    const table = buildRoutes({ ...base, processes: [proc('r1', 'dev')], ports: [port(443, 'r1', 'dev'), port(0, 'r1', 'dev')] });
    expect(table.routes[0]).toMatchObject({ name: 'shop.localhost', port: null, source: 'none' });
  });

  it('marks IPv6-only targets and the projects whose Host is rewritten', () => {
    const table = buildRoutes({
      ...base,
      rewriteHost: { r1: true },
      processes: [proc('r1', 'dev')],
      ports: [port(3000, 'r1', 'dev', ['::1'])],
    });
    expect(table.byName.get('shop.localhost')).toMatchObject({ ipv6Only: true, rewriteHost: true });
  });
});

describe('resolveHost', () => {
  const table = buildRoutes({ ...base, processes: [proc('r1', 'dev')], ports: [port(3000, 'r1', 'dev')] });

  it('normalises case, a trailing dot and a port', () => {
    for (const host of ['shop.localhost', 'SHOP.Localhost', 'shop.localhost.', 'shop.localhost:443']) {
      expect(resolveHost(table, host)).toMatchObject({ kind: 'forward', port: 3000 });
    }
  });

  it('answers not-running, unknown and forbidden', () => {
    expect(resolveHost(table, 'api.shop.localhost')).toMatchObject({ kind: 'not-running' });
    expect(resolveHost(table, 'nope.localhost')).toEqual({ kind: 'unknown', known: ['api.shop.localhost', 'shop.localhost'] });
    for (const host of ['example.com', 'localhost', '127.0.0.1', '[::1]:443', undefined, 'evil.localhost.example.com']) {
      expect(resolveHost(table, host)).toEqual({ kind: 'forbidden' });
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/main/domains/router.test.ts`
Expected: FAIL, "Failed to resolve import ./router".

- [ ] **Step 3: Write `src/main/domains/router.ts`**

```ts
// Which port each local domain reaches: the package's main command, else its earliest-started running
// script, else the detected port; other running servers get <script>.<name>.localhost. Pure: the service
// gathers the inputs and rebuilds the table when processes, ports or projects change.
import type { Route } from '@shared/domains';
import type { PortRow } from '@shared/ports';
import { isLive, type ProcessSummary } from '@shared/processes';
import { hostName } from '../net/forward';
import { assignNames, type NamedProject, toLabel } from './names';

export interface RouterInput {
  projects: readonly NamedProject[];
  overrides: Readonly<Record<string, string>>;
  rewriteHost: Readonly<Record<string, true>>;
  /** projectId → the package's main command. */
  mainScripts: ReadonlyMap<string, string>;
  processes: readonly ProcessSummary[];
  ports: readonly PortRow[];
  /** projectId → .env's PORT, else the ecosystems' first detected port. */
  detectedPorts: ReadonlyMap<string, number>;
  /** The proxy's own ports: never a target. */
  ownPorts: readonly number[];
}

export type RouteTarget = Route & { ipv6Only: boolean };

export interface RouteTable {
  routes: Route[];
  clashes: string[];
  byName: ReadonlyMap<string, RouteTarget>;
}

export type Resolution =
  | { kind: 'forward'; route: RouteTarget; port: number }
  | { kind: 'not-running'; route: RouteTarget }
  | { kind: 'unknown'; known: string[] }
  | { kind: 'forbidden' };

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+localhost$/;

export function buildRoutes(input: RouterInput): RouteTable {
  const { names, clashes } = assignNames(input.projects, input.overrides);
  const usable = (row: PortRow) => row.port > 0 && !input.ownPorts.includes(row.port);
  const routes: RouteTarget[] = [];
  const target = (projectId: string, name: string, script: string | null, row: PortRow | null, source: Route['source'], port?: number): RouteTarget => ({
    name,
    projectId,
    script,
    port: row?.port ?? port ?? null,
    source,
    ipv6Only: row !== null && row.addresses.length > 0 && row.addresses.every((a) => a.includes(':')),
    rewriteHost: input.rewriteHost[projectId] === true,
  });

  for (const [projectId, name] of names) {
    // Running scripts in start order, each with its lowest usable listening port.
    const running = input.processes
      .filter((p) => p.projectId === projectId && isLive(p.state))
      .map((p) => {
        const rows = input.ports.filter((r) => r.owner?.projectId === projectId && r.owner.script === p.script && usable(r));
        rows.sort((a, b) => a.port - b.port);
        return { script: p.script, row: rows[0] ?? null };
      })
      .filter((s): s is { script: string; row: PortRow } => s.row !== null);
    const main = input.mainScripts.get(projectId);
    const primary = running.find((s) => s.script === main) ?? running[0] ?? null;
    if (primary) {
      routes.push(target(projectId, name, primary.script, primary.row, primary.script === main ? 'main' : 'script'));
    } else {
      const detected = input.detectedPorts.get(projectId);
      const ok = detected !== undefined && detected > 0 && !input.ownPorts.includes(detected);
      routes.push(target(projectId, name, null, null, ok ? 'detected' : 'none', ok ? detected : undefined));
    }
    for (const extra of running) {
      if (extra === primary) continue;
      routes.push(target(projectId, `${toLabel(extra.script)}.${name}`, extra.script, extra.row, 'script'));
    }
  }
  const byName = new Map<string, RouteTarget>();
  for (const route of routes) if (!byName.has(route.name)) byName.set(route.name, route);
  return {
    routes: routes.map(({ ipv6Only: _i, ...route }) => route),
    clashes,
    byName,
  };
}

export function resolveHost(table: RouteTable, host: string | undefined): Resolution {
  const name = hostName(host).replace(/\.$/, '');
  if (!HOST.test(name)) return { kind: 'forbidden' };
  const route = table.byName.get(name);
  if (!route) return { kind: 'unknown', known: [...table.byName.keys()].sort() };
  return route.port === null ? { kind: 'not-running', route } : { kind: 'forward', route, port: route.port };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/main/domains/router.test.ts`
Expected: PASS. If `isLive` isn't exported from `@shared/processes`, use `p.state === 'running' || p.state === 'starting'` (check `PROCESS_STATES`) and adjust the test's `proc` helper.

- [ ] **Step 5: Commit**

```bash
git add src/main/domains/router.ts src/main/domains/router.test.ts
git commit -m "feat(domains): route table from main commands, running scripts and detected ports

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Proxy over HTTP (pages, redirect, bind states)

**Files:**
- Create: `src/main/domains/pages.ts`, `src/main/domains/proxy.ts`, `src/main/domains/proxy.test.ts`

**Interfaces:**
- Consumes: `resolveHost`, `RouteTable` (Task 4); `proxyRequestHeaders` (Task 1); `ServerState` (Task 2).
- Produces:
  - `pages.ts`: `forbiddenPage(): string`, `unknownPage(known: readonly string[]): string`, `notRunningPage(name: string): string`, `badGatewayPage(name: string, port: number): string`
  - `proxy.ts`: `interface DomainsProxy { start(opts: { httpPort: number; httpsPort: number; sni: SniResolver | null }): Promise<{ http: ServerState; https: ServerState }>; stop(): Promise<void> }`, `type SniResolver = (servername: string) => Promise<{ cert: string; key: string }>`, `createDomainsProxy(deps: { table(): RouteTable; logger: Logger; hosts?: readonly string[] }): DomainsProxy` (`hosts` defaults to `['127.0.0.1', '::1']`).

- [ ] **Step 1: Write the failing test** `src/main/domains/proxy.test.ts`

```ts
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../logger';
import { createDomainsProxy, type DomainsProxy } from './proxy';
import { buildRoutes, type RouteTable } from './router';

const servers: Server[] = [];
let proxy: DomainsProxy | null = null;
afterEach(async () => {
  await proxy?.stop();
  proxy = null;
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

async function echoTarget(): Promise<number> {
  const s = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ url: req.url, headers: req.headers }));
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return (s.address() as AddressInfo).port;
}

function tableFor(port: number | null): RouteTable {
  return buildRoutes({
    projects: [{ id: 'r1', name: 'shop', workspaces: [] }],
    overrides: {},
    rewriteHost: {},
    mainScripts: new Map(),
    processes: port === null ? [] : [{ projectId: 'r1', script: 'dev', state: 'running', startedAt: 1 } as never],
    ports: port === null ? [] : [{ port, pid: 1, addresses: ['127.0.0.1'], processName: 'node', command: null, owner: { projectId: 'r1', script: 'dev' } }],
    detectedPorts: new Map(),
    ownPorts: [],
  });
}

function get(port: number, host: string, path = '/x?y=1'): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('domains proxy over HTTP', () => {
  it('forwards to the route with X-Forwarded-* and the Host kept', async () => {
    const target = await echoTarget();
    let table = tableFor(target);
    proxy = createDomainsProxy({ table: () => table, logger: createMemoryLogger(), hosts: ['127.0.0.1'] });
    const httpPort = await freePort();
    const state = await proxy.start({ httpPort, httpsPort: await freePort(), sni: null });
    expect(state.http).toMatchObject({ state: 'running', port: httpPort });
    const res = await get(httpPort, 'shop.localhost');
    expect(res.status).toBe(200);
    const seen = JSON.parse(res.body) as { url: string; headers: Record<string, string> };
    expect(seen.url).toBe('/x?y=1');
    expect(seen.headers).toMatchObject({ host: 'shop.localhost', 'x-forwarded-host': 'shop.localhost', 'x-forwarded-proto': 'http' });
    // The table is read per request: a stopped script answers the not-running page at once.
    table = tableFor(null);
    expect((await get(httpPort, 'shop.localhost')).status).toBe(503);
  });

  it('answers 403, 404 and 502 pages without echoing the request', async () => {
    const dead = await freePort();
    proxy = createDomainsProxy({ table: () => tableFor(dead), logger: createMemoryLogger(), hosts: ['127.0.0.1'] });
    const httpPort = await freePort();
    await proxy.start({ httpPort, httpsPort: await freePort(), sni: null });
    expect((await get(httpPort, 'example.com')).status).toBe(403);
    const unknown = await get(httpPort, 'nope.localhost', '/secret-path');
    expect(unknown.status).toBe(404);
    expect(unknown.body).toContain('shop.localhost');
    expect(unknown.body).not.toContain('secret-path');
    expect((await get(httpPort, 'shop.localhost')).status).toBe(502);
  });

  it('reports a taken port as failed and keeps the other server', async () => {
    const taken = createServer();
    servers.push(taken);
    await new Promise<void>((r) => taken.listen(0, '127.0.0.1', r));
    const takenPort = (taken.address() as AddressInfo).port;
    proxy = createDomainsProxy({ table: () => tableFor(null), logger: createMemoryLogger(), hosts: ['127.0.0.1'] });
    const state = await proxy.start({ httpPort: takenPort, httpsPort: await freePort(), sni: null });
    expect(state.http).toEqual({ state: 'failed', port: takenPort, code: 'EADDRINUSE', owner: null });
  });

  it('stops, and starts again on new ports (Review Focus 3)', async () => {
    proxy = createDomainsProxy({ table: () => tableFor(null), logger: createMemoryLogger(), hosts: ['127.0.0.1'] });
    const first = await freePort();
    await proxy.start({ httpPort: first, httpsPort: await freePort(), sni: null });
    const second = await freePort();
    await proxy.stop();
    const state = await proxy.start({ httpPort: second, httpsPort: await freePort(), sni: null });
    expect(state.http).toMatchObject({ state: 'running', port: second });
    await expect(get(first, 'shop.localhost')).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/main/domains/proxy.test.ts`
Expected: FAIL, "Failed to resolve import ./proxy".

- [ ] **Step 3: Write `src/main/domains/pages.ts`**

```ts
// The small pages the domains proxy answers itself. They never echo the request (paths, headers).
const STYLE =
  'body{font:14px system-ui,sans-serif;background:rgb(16,18,22);color:rgb(226,230,236);margin:48px}' +
  'h1{font-size:18px}code{background:rgb(32,36,44);padding:1px 4px;border-radius:4px}' +
  '@media (prefers-color-scheme: light){body{background:rgb(250,250,250);color:rgb(24,24,27)}code{background:rgb(235,235,240)}}';

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>${STYLE}</style></head><body><h1>${escape(title)}</h1>${body}<p>NestBox local domains</p></body></html>`;
}

export const forbiddenPage = () =>
  page('Not a NestBox domain', '<p>NestBox only answers names under <code>.localhost</code>.</p>');

export const unknownPage = (known: readonly string[]) =>
  page(
    'Unknown name',
    known.length === 0
      ? '<p>No project has a local domain yet.</p>'
      : `<p>Known names:</p><ul>${known.map((n) => `<li><code>${escape(n)}</code></li>`).join('')}</ul>`,
  );

export const notRunningPage = (name: string) =>
  page(`${name} isn't running`, '<p>Start its main command in NestBox, then reload this page.</p>');

export const badGatewayPage = (name: string, port: number) =>
  page(`${name} isn't answering`, `<p>Nothing accepted the connection on port <code>${port}</code>.</p>`);
```

- [ ] **Step 4: Write `src/main/domains/proxy.ts`** (HTTP part; Task 6 adds upgrades, Task 7 plugs in SNI)

```ts
// The local domains proxy: HTTP and HTTPS servers on loopback that stream each request to the port its
// Host routes to. Nothing is recorded; the route table is read per request. Logs carry names, ports and codes.
import { createServer as createHttpServer, type IncomingMessage, request, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createSecureContext, type SecureContext } from 'node:tls';
import type { ServerState } from '@shared/domains';
import type { Logger } from '../logger';
import { proxyRequestHeaders } from '../net/forward';
import { badGatewayPage, forbiddenPage, notRunningPage, unknownPage } from './pages';
import { resolveHost, type RouteTable } from './router';

export type SniResolver = (servername: string) => Promise<{ cert: string; key: string }>;

export interface DomainsProxy {
  start(opts: { httpPort: number; httpsPort: number; sni: SniResolver | null }): Promise<{ http: ServerState; https: ServerState }>;
  stop(): Promise<void>;
}

const send = (res: ServerResponse, status: number, html: string) => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
};

export function createDomainsProxy(deps: { table(): RouteTable; logger: Logger; hosts?: readonly string[] }): DomainsProxy {
  const hosts = deps.hosts ?? ['127.0.0.1', '::1'];
  let servers: Server[] = [];
  let httpsPort: number | null = null;

  function handle(proto: 'http' | 'https') {
    return (req: IncomingMessage, res: ServerResponse) => {
      const resolution = resolveHost(deps.table(), req.headers.host);
      if (resolution.kind === 'forbidden') return send(res, 403, forbiddenPage());
      if (resolution.kind === 'unknown') return send(res, 404, unknownPage(resolution.known));
      if (resolution.kind === 'not-running') return send(res, 503, notRunningPage(resolution.route.name));
      const { route, port } = resolution;
      if (proto === 'http' && httpsPort !== null) {
        const suffix = httpsPort === 443 ? '' : `:${httpsPort}`;
        res.writeHead(308, { location: `https://${route.name}${suffix}${req.url ?? '/'}` });
        return res.end();
      }
      const upstream = request({
        host: route.ipv6Only ? '::1' : '127.0.0.1',
        port,
        method: req.method,
        path: req.url,
        headers: proxyRequestHeaders(req.rawHeaders, {
          host: route.name,
          proto,
          remoteAddress: req.socket.remoteAddress,
          rewriteHostTo: route.rewriteHost ? `localhost:${port}` : null,
        }),
      });
      upstream.on('response', (up) => {
        res.writeHead(up.statusCode ?? 502, up.rawHeaders);
        up.pipe(res);
      });
      upstream.on('error', (error: NodeJS.ErrnoException) => {
        deps.logger.info('domains upstream failed', { name: route.name, port, code: error.code ?? 'unknown' });
        if (!res.headersSent) send(res, 502, badGatewayPage(route.name, port));
        else res.destroy();
      });
      req.on('aborted', () => upstream.destroy());
      req.pipe(upstream);
    };
  }

  /** Binds one server per loopback address; the first address decides the state. IPv6 may be missing. */
  async function bind(make: () => Server, port: number): Promise<ServerState> {
    let primary: ServerState | null = null;
    for (const host of hosts) {
      const server = make();
      const result = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
        server.once('error', resolve);
        server.listen(port, host, () => resolve(null));
      });
      if (result === null) servers.push(server);
      if (primary === null) {
        primary = result === null
          ? { state: 'running', port, code: null, owner: null }
          : { state: 'failed', port, code: result.code ?? 'UNKNOWN', owner: null };
        if (result !== null) break;
      }
    }
    return primary ?? { state: 'failed', port, code: 'UNKNOWN', owner: null };
  }

  return {
    async start({ httpPort, httpsPort: wantedHttps, sni }) {
      await this.stop();
      let https: ServerState = { state: 'off', port: wantedHttps, code: null, owner: null };
      if (sni) {
        const contexts = new Map<string, SecureContext>();
        https = await bind(
          () =>
            createHttpsServer(
              {
                SNICallback: (servername, cb) => {
                  const cached = contexts.get(servername);
                  if (cached) return cb(null, cached);
                  sni(servername)
                    .then((pair) => {
                      const ctx = createSecureContext(pair);
                      contexts.set(servername, ctx);
                      cb(null, ctx);
                    })
                    .catch((error: unknown) => cb(error instanceof Error ? error : new Error('sni failed')));
                },
              },
              handle('https'),
            ),
          wantedHttps,
        );
      }
      httpsPort = https.state === 'running' ? wantedHttps : null;
      const http = await bind(() => createHttpServer(handle('http')), httpPort);
      deps.logger.info('domains started', { http: http.state, https: https.state, httpPort, httpsPort: wantedHttps });
      return { http, https };
    },

    async stop() {
      const closing = servers;
      servers = [];
      httpsPort = null;
      await Promise.all(
        closing.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => resolve());
              server.closeAllConnections?.();
            }),
        ),
      );
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/main/domains/proxy.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/domains/pages.ts src/main/domains/proxy.ts src/main/domains/proxy.test.ts
git commit -m "feat(domains): HTTP proxy with its own pages, redirect and bind states

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: WebSocket upgrades

**Files:**
- Modify: `src/main/domains/proxy.ts`, `src/main/domains/proxy.test.ts`

**Interfaces:**
- Consumes: `resolveHost` (Task 4), `proxyRequestHeaders` (Task 1).
- Produces: an `upgrade` handler on every server `createDomainsProxy` creates. `stop()` also destroys the upgraded sockets.

- [ ] **Step 1: Write the failing tests** (append to `proxy.test.ts`)

```ts
import { connect, type Socket } from 'node:net';

/** A raw upgrade: the target answers 101 and echoes what it gets afterwards. */
async function upgradeTarget(behaviour: 'echo' | 'close'): Promise<number> {
  const s = createServer();
  s.on('upgrade', (req, socket: Socket) => {
    if (behaviour === 'close') return socket.destroy();
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write(d));
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return (s.address() as AddressInfo).port;
}

function rawUpgrade(port: number, host: string): Promise<{ head: string; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(`GET /hmr HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    });
    socket.once('data', (d) => resolve({ head: d.toString(), socket }));
    socket.on('error', reject);
  });
}

describe('domains proxy upgrades', () => {
  it('pipes a WebSocket upgrade both ways', async () => {
    const target = await upgradeTarget('echo');
    proxy = createDomainsProxy({ table: () => tableFor(target), logger: createMemoryLogger(), hosts: ['127.0.0.1'] });
    const httpPort = await freePort();
    await proxy.start({ httpPort, httpsPort: await freePort(), sni: null });
    const { head, socket } = await rawUpgrade(httpPort, 'shop.localhost');
    expect(head).toContain('101 Switching Protocols');
    const echoed = new Promise<string>((r) => socket.once('data', (d) => r(d.toString())));
    socket.write('ping');
    expect(await echoed).toBe('ping');
    socket.destroy();
  });

  it('closes the client when the target drops the upgrade (Review Focus 4)', async () => {
    const target = await upgradeTarget('close');
    proxy = createDomainsProxy({ table: () => tableFor(target), logger: createMemoryLogger(), hosts: ['127.0.0.1'] });
    const httpPort = await freePort();
    await proxy.start({ httpPort, httpsPort: await freePort(), sni: null });
    const socket = connect(httpPort, '127.0.0.1', () =>
      socket.write('GET / HTTP/1.1\r\nHost: shop.localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'),
    );
    await new Promise<void>((r) => socket.on('close', () => r()));
  });

  it('refuses an upgrade for a foreign Host', async () => {
    proxy = createDomainsProxy({ table: () => tableFor(null), logger: createMemoryLogger(), hosts: ['127.0.0.1'] });
    const httpPort = await freePort();
    await proxy.start({ httpPort, httpsPort: await freePort(), sni: null });
    const { head } = await rawUpgrade(httpPort, 'example.com');
    expect(head).toMatch(/^HTTP\/1\.1 403/);
  });
});
```


- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/main/domains/proxy.test.ts -t upgrades`
Expected: FAIL. The first test hangs until its timeout (no `upgrade` listener: Node destroys the socket), or reads no 101.

- [ ] **Step 3: Implement upgrades** in `proxy.ts`

Add these imports: `import { connect, type Socket } from 'node:net';` and `import type { Duplex } from 'node:stream';`. Then add, inside `createDomainsProxy`:

```ts
  const tunnels = new Set<Duplex>();

  function refuse(socket: Duplex, status: number, reason: string) {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  function upgrade(proto: 'http' | 'https') {
    return (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const resolution = resolveHost(deps.table(), req.headers.host);
      if (resolution.kind === 'forbidden') return refuse(socket, 403, 'Forbidden');
      if (resolution.kind !== 'forward') return refuse(socket, resolution.kind === 'unknown' ? 404 : 503, 'Unavailable');
      const { route, port } = resolution;
      // Upgrade and Connection are hop-by-hop: put them back for the target.
      const headers = proxyRequestHeaders(req.rawHeaders, {
        host: route.name,
        proto,
        remoteAddress: req.socket.remoteAddress,
        rewriteHostTo: route.rewriteHost ? `localhost:${port}` : null,
      });
      const lines = [`${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/1.1`];
      for (let i = 0; i + 1 < headers.length; i += 2) lines.push(`${headers[i]}: ${headers[i + 1]}`);
      lines.push(`Connection: Upgrade`, `Upgrade: ${req.headers.upgrade ?? 'websocket'}`);
      const upstream: Socket = connect(port, route.ipv6Only ? '::1' : '127.0.0.1');
      tunnels.add(socket);
      tunnels.add(upstream);
      const close = () => {
        socket.destroy();
        upstream.destroy();
        tunnels.delete(socket);
        tunnels.delete(upstream);
      };
      upstream.once('connect', () => {
        upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', (error: NodeJS.ErrnoException) => {
        deps.logger.info('domains upgrade failed', { name: route.name, port, code: error.code ?? 'unknown' });
        close();
      });
      socket.on('error', close);
      upstream.on('close', close);
      socket.on('close', close);
    };
  }
```

Register it on every server. In `bind`'s callers, attach it when making each server:

```ts
          () => {
            const server = createHttpsServer({ /* SNICallback as before */ }, handle('https'));
            server.on('upgrade', upgrade('https'));
            return server;
          },
```

and

```ts
      const http = await bind(() => {
        const server = createHttpServer(handle('http'));
        server.on('upgrade', upgrade('http'));
        return server;
      }, httpPort);
```

In `stop()`, before closing the servers:

```ts
      for (const socket of tunnels) socket.destroy();
      tunnels.clear();
```

An upgrade on plain HTTP while HTTPS runs is **not** redirected: browsers don't follow redirects on WebSocket handshakes, and a dev page served over HTTPS connects with `wss://` anyway.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/main/domains/proxy.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/domains/proxy.ts src/main/domains/proxy.test.ts
git commit -m "feat(domains): pass WebSocket upgrades through for hot reload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The local CA and HTTPS

**Files:**
- Create: `src/main/domains/ca.ts`, `src/main/domains/ca.test.ts`
- Modify: `src/main/domains/proxy.test.ts` (an HTTPS test)

**Interfaces:**
- Produces:
  - `interface LocalCa { root(): Promise<{ cert: string; sha1: string; serialHex: string }>; leaf(host: string): Promise<{ cert: string; key: string }>; reset(): Promise<void>; regenerated(): boolean }`
  - `createLocalCa(deps: { file: string; now(): number; logger: Logger }): LocalCa`
  - `NAME_CONSTRAINTS_OID = '2.5.29.30'`

- [ ] **Step 1: Write the failing test** `src/main/domains/ca.test.ts`

```ts
import { X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from '../logger';
import { createLocalCa } from './ca';

const DAY = 86_400_000;
const dir = () => mkdtemp(join(tmpdir(), 'nestbox-ca-'));

describe('local CA', () => {
  it('makes a name-constrained root and leaves it signed, reused from disk', async () => {
    const file = join(await dir(), 'domains-ca.json');
    let now = Date.UTC(2026, 9, 14);
    const ca = createLocalCa({ file, now: () => now, logger: createMemoryLogger() });
    const root = await ca.root();
    const x = new X509Certificate(root.cert);
    expect(x.subject).toContain('CN=NestBox Local CA');
    expect(x.ca).toBe(true);
    expect(root.sha1).toMatch(/^[0-9a-f]{40}$/);
    const parsed = new (await import('@peculiar/x509')).X509Certificate(root.cert);
    expect(parsed.extensions.find((e) => e.type === '2.5.29.30')?.critical).toBe(true);
    const leaf = await ca.leaf('shop.localhost');
    const lx = new X509Certificate(leaf.cert);
    expect(lx.checkIssued(x)).toBe(true);
    expect(lx.subjectAltName).toBe('DNS:shop.localhost');
    // A second CA object on the same file reuses root and leaf.
    const again = createLocalCa({ file, now: () => now, logger: createMemoryLogger() });
    expect((await again.root()).sha1).toBe(root.sha1);
    expect((await again.leaf('shop.localhost')).cert).toBe(leaf.cert);
    // Within 30 days of expiry, the leaf is renewed; the root stays.
    now += 340 * DAY;
    expect((await again.leaf('shop.localhost')).cert).not.toBe(leaf.cert);
    expect((await again.root()).sha1).toBe(root.sha1);
  });

  it('never makes a leaf outside .localhost', async () => {
    const ca = createLocalCa({ file: join(await dir(), 'ca.json'), now: Date.now, logger: createMemoryLogger() });
    await expect(ca.leaf('example.com')).rejects.toThrow();
  });

  it('regenerates a corrupt file and says so (Review Focus 5)', async () => {
    const file = join(await dir(), 'domains-ca.json');
    await writeFile(file, '{"root":{"cert":"-----BEGIN');
    const ca = createLocalCa({ file, now: Date.now, logger: createMemoryLogger() });
    await ca.root();
    expect(ca.regenerated()).toBe(true);
    expect(JSON.parse(await readFile(file, 'utf8'))).toHaveProperty('root.cert');
  });
});
```

- [ ] **Step 2: Add the HTTPS test** to `proxy.test.ts`

```ts
import { request as httpsRequest } from 'node:https';
import { createLocalCa } from './ca';

describe('domains proxy over HTTPS', () => {
  it('serves a leaf for the requested name, valid against the root, and redirects HTTP', async () => {
    const target = await echoTarget();
    const ca = createLocalCa({ file: join(await mkdtemp(join(tmpdir(), 'nestbox-ca-')), 'ca.json'), now: Date.now, logger: createMemoryLogger() });
    const root = await ca.root();
    proxy = createDomainsProxy({ table: () => tableFor(target), logger: createMemoryLogger(), hosts: ['127.0.0.1'] });
    const httpPort = await freePort();
    const httpsPort = await freePort();
    const state = await proxy.start({ httpPort, httpsPort, sni: (name) => ca.leaf(name) });
    expect(state.https.state).toBe('running');
    const redirect = await get(httpPort, 'shop.localhost', '/a?b=1');
    expect(redirect.status).toBe(308);
    expect(redirect.headers['location']).toBe(`https://shop.localhost:${httpsPort}/a?b=1`);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpsRequest(
        { host: '127.0.0.1', port: httpsPort, servername: 'shop.localhost', ca: root.cert, headers: { host: 'shop.localhost' }, path: '/' },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(200);
  });
});
```

(Add `mkdtemp` from `node:fs/promises`, `tmpdir` from `node:os` and `join` from `node:path` to the test's imports.)

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run src/main/domains/ca.test.ts src/main/domains/proxy.test.ts -t "CA|HTTPS"`
Expected: FAIL, "Failed to resolve import ./ca".

- [ ] **Step 4: Write `src/main/domains/ca.ts`**

```ts
// NestBox's local certificate authority for local domains. The root is name-constrained to .localhost (a
// critical extension), so even a leaked key can't make a certificate a browser accepts for a real site.
// Leaves are made per host name on demand. Certificates and keys never leave this module except to the
// TLS server, and are never logged.
import { createHash, randomBytes, webcrypto } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { AsnConvert } from '@peculiar/asn1-schema';
import { GeneralName, GeneralSubtree, GeneralSubtrees, NameConstraints } from '@peculiar/asn1-x509';
import * as x509 from '@peculiar/x509';
import { z } from 'zod';
import type { Logger } from '../logger';

export const NAME_CONSTRAINTS_OID = '2.5.29.30';
const DAY = 86_400_000;
const ROOT_DAYS = 3650;
const LEAF_DAYS = 365;
const RENEW_DAYS = 30;
const ALG = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 } as const;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+localhost$/;

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

const PairSchema = z.object({ cert: z.string().min(1), key: z.string().min(1) });
const FileSchema = z.object({
  root: PairSchema.extend({ sha1: z.string(), serialHex: z.string() }),
  leaves: z.record(z.string(), PairSchema.extend({ validUntil: z.number() })),
});
type CaFile = z.infer<typeof FileSchema>;

export interface LocalCa {
  root(): Promise<{ cert: string; sha1: string; serialHex: string }>;
  leaf(host: string): Promise<{ cert: string; key: string }>;
  /** Deletes the CA (the file is rewritten with a new root on next use). */
  reset(): Promise<void>;
  /** The file was missing or unreadable and a new root was made: trust must be asked again. */
  regenerated(): boolean;
}

const serial = () => randomBytes(16).toString('hex').replace(/^[89a-f]/, '1');

async function keyPem(key: CryptoKey): Promise<string> {
  const der = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', key as unknown as webcrypto.CryptoKey));
  return `-----BEGIN PRIVATE KEY-----\n${der.toString('base64').match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

async function importKey(pem: string): Promise<CryptoKey> {
  const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  return webcrypto.subtle.importKey('pkcs8', der, ALG, false, ['sign']) as unknown as Promise<CryptoKey>;
}

async function makeRoot(now: number): Promise<CaFile['root']> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as unknown as CryptoKeyPair;
  const constraints = new NameConstraints({
    permittedSubtrees: new GeneralSubtrees([new GeneralSubtree({ base: new GeneralName({ dNSName: 'localhost' }) })]),
  });
  const serialHex = serial();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serialHex,
    name: 'CN=NestBox Local CA, O=NestBox',
    notBefore: new Date(now - DAY),
    notAfter: new Date(now + ROOT_DAYS * DAY),
    keys,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      new x509.Extension(NAME_CONSTRAINTS_OID, true, AsnConvert.serialize(constraints)),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  const pem = cert.toString('pem');
  return {
    cert: pem,
    key: await keyPem(keys.privateKey),
    sha1: createHash('sha1').update(Buffer.from(cert.rawData)).digest('hex'),
    serialHex,
  };
}

async function makeLeaf(root: CaFile['root'], host: string, now: number): Promise<CaFile['leaves'][string]> {
  const keys = (await webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as unknown as CryptoKeyPair;
  const issuer = new x509.X509Certificate(root.cert);
  const validUntil = now + LEAF_DAYS * DAY;
  const cert = await x509.X509CertificateGenerator.create({
    serialNumber: serial(),
    subject: `CN=${host}`,
    issuer: issuer.subject,
    notBefore: new Date(now - DAY),
    notAfter: new Date(validUntil),
    signingKey: await importKey(root.key),
    publicKey: keys.publicKey,
    signingAlgorithm: ALG,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
      new x509.ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1']),
      new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: host }]),
      await x509.AuthorityKeyIdentifierExtension.create(issuer),
    ],
  });
  return { cert: cert.toString('pem'), key: await keyPem(keys.privateKey), validUntil };
}

export function createLocalCa(deps: { file: string; now(): number; logger: Logger }): LocalCa {
  let state: CaFile | null = null;
  let fresh = false;
  let pending: Promise<CaFile> | null = null;

  async function persist(data: CaFile) {
    const tmp = `${deps.file}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, deps.file);
  }

  function load(): Promise<CaFile> {
    if (state) return Promise.resolve(state);
    pending ??= (async () => {
      try {
        const parsed = FileSchema.parse(JSON.parse(await readFile(deps.file, 'utf8')));
        new x509.X509Certificate(parsed.root.cert); // throws on a damaged PEM
        state = parsed;
      } catch {
        fresh = true;
        state = { root: await makeRoot(deps.now()), leaves: {} };
        await persist(state);
        deps.logger.info('domains ca created');
      }
      return state;
    })().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    async root() {
      const { root } = await load();
      return { cert: root.cert, sha1: root.sha1, serialHex: root.serialHex };
    },
    async leaf(host) {
      const name = host.toLowerCase();
      if (!HOST.test(name)) throw new Error('not a .localhost name');
      const data = await load();
      const cached = data.leaves[name];
      if (cached && cached.validUntil - deps.now() > RENEW_DAYS * DAY) return { cert: cached.cert, key: cached.key };
      const made = await makeLeaf(data.root, name, deps.now());
      data.leaves[name] = made;
      await persist(data);
      return { cert: made.cert, key: made.key };
    },
    async reset() {
      state = null;
      fresh = false;
      await writeFile(deps.file, '{}', { mode: 0o600 });
    },
    regenerated: () => fresh,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/main/domains`
Expected: PASS. Generating RSA keys takes about 100 ms each; if the CA tests near Vitest's 5 s default under load, give that `describe` `{ timeout: 20_000 }`.

- [ ] **Step 6: Commit**

```bash
git add src/main/domains/ca.ts src/main/domains/ca.test.ts src/main/domains/proxy.test.ts
git commit -m "feat(domains): local CA name-constrained to .localhost, leaves per name over SNI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Adapter trust helpers

**Files:**
- Modify: `src/main/platform/adapter.ts`, `src/main/platform/win32.ts`, `src/main/platform/win32.test.ts`, `src/main/platform/darwin.ts`, `src/main/platform/darwin.test.ts`

**Interfaces:**
- Produces on `PlatformAdapter`:
  - `trustRootCa(certFile: string): Promise<'trusted' | 'cancelled' | 'failed'>`
  - `untrustRootCa(ids: { sha1: string; serialHex: string }): Promise<'removed' | 'failed'>`

- [ ] **Step 1: Write the failing tests**

In `win32.test.ts` (use the file's existing `fakeRunner`, which records `calls` with `{ file, args }` and returns `{ code: 0, stdout: '' }` unless scripted; check how existing tests script exec results and follow the same pattern):

```ts
describe('win32 trust store', () => {
  it("adds the root to the user's store and reads a cancel", async () => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    expect(await adapter.trustRootCa('C:\\Temp\\nestbox-ca.crt')).toBe('trusted');
    expect(runner.calls.at(-1)).toMatchObject({ file: 'certutil.exe', args: ['-user', '-addstore', 'Root', 'C:\\Temp\\nestbox-ca.crt'] });
  });

  it('removes it by serial', async () => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    expect(await adapter.untrustRootCa({ sha1: 'ab'.repeat(20), serialHex: '1f2e' })).toBe('removed');
    expect(runner.calls.at(-1)).toMatchObject({ file: 'certutil.exe', args: ['-user', '-delstore', 'Root', '1f2e'] });
  });

  it('refuses ids that are not hex', async () => {
    const adapter = createWin32Adapter({ runner: fakeRunner(), getEditorCommand: () => 'code' });
    await expect(adapter.untrustRootCa({ sha1: 'x', serialHex: '1 & del' })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
```

Add a cancel case with the scripted exec result `{ code: -2147023673, stdout: 'CertUtil: -addstore command FAILED: 0x800704c7 (WIN32: 1223 ERROR_CANCELLED)' }`, expecting `'cancelled'`, and any other non-zero code expecting `'failed'`.

In `darwin.test.ts`:

```ts
describe('darwin trust store', () => {
  it("adds the root to the login keychain as a trust root, and removes it by hash", async () => {
    const runner = fakeRunner();
    const adapter = createDarwinAdapter({ runner, getEditorCommand: () => 'code' });
    expect(await adapter.trustRootCa('/tmp/nestbox-ca.crt')).toBe('trusted');
    const add = runner.calls.at(-1);
    expect(add?.file).toBe('/usr/bin/security');
    expect(add?.args.slice(0, 4)).toEqual(['add-trusted-cert', '-r', 'trustRoot', '-k']);
    expect(add?.args[4]).toMatch(/Library\/Keychains\/login\.keychain-db$/);
    expect(add?.args[5]).toBe('/tmp/nestbox-ca.crt');
    expect(await adapter.untrustRootCa({ sha1: 'ab'.repeat(20), serialHex: '1f' })).toBe('removed');
    expect(runner.calls.at(-1)?.args.slice(0, 2)).toEqual(['delete-certificate', '-Z']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run src/main/platform/win32.test.ts src/main/platform/darwin.test.ts -t trust`
Expected: FAIL, "adapter.trustRootCa is not a function".

- [ ] **Step 3: Add to the interface** in `adapter.ts`:

```ts
  /**
   * Adds NestBox's local CA root to the current user's trust store. The OS shows its own prompt;
   * 'cancelled' only where the OS reports it (Windows). Never logs or returns command output.
   */
  trustRootCa(certFile: string): Promise<'trusted' | 'cancelled' | 'failed'>;
  /** Removes that root again, by serial (Windows) or SHA-1 (macOS); hex strings only. */
  untrustRootCa(ids: { sha1: string; serialHex: string }): Promise<'removed' | 'failed'>;
```

- [ ] **Step 4: Implement in `win32.ts`**, next to the other exec-based methods:

```ts
    async trustRootCa(certFile) {
      const { code, stdout } = await deps.runner.exec('certutil.exe', ['-user', '-addstore', 'Root', certFile], {
        timeoutMs: 300_000,
      });
      if (code === 0) return 'trusted';
      return /800704c7|ERROR_CANCELLED/i.test(stdout) ? 'cancelled' : 'failed';
    },

    async untrustRootCa({ serialHex }) {
      if (!/^[0-9a-f]{1,64}$/i.test(serialHex)) throw new NestboxError('VALIDATION', 'Invalid certificate serial');
      const { code } = await deps.runner.exec('certutil.exe', ['-user', '-delstore', 'Root', serialHex], { timeoutMs: 300_000 });
      return code === 0 ? 'removed' : 'failed';
    },
```

- [ ] **Step 5: Implement in `darwin.ts`** (`homedir` from `node:os`, `join` from `node:path`; check the file's existing imports):

```ts
    async trustRootCa(certFile) {
      const keychain = join(homedir(), 'Library', 'Keychains', 'login.keychain-db');
      const { code } = await deps.runner.exec(
        '/usr/bin/security',
        ['add-trusted-cert', '-r', 'trustRoot', '-k', keychain, certFile],
        { timeoutMs: 300_000 },
      );
      // security reports a cancel on stderr only, which exec doesn't return: both are 'failed'.
      return code === 0 ? 'trusted' : 'failed';
    },

    async untrustRootCa({ sha1 }) {
      if (!/^[0-9a-f]{40}$/i.test(sha1)) throw new NestboxError('VALIDATION', 'Invalid certificate hash');
      const keychain = join(homedir(), 'Library', 'Keychains', 'login.keychain-db');
      const { code } = await deps.runner.exec('/usr/bin/security', ['delete-certificate', '-Z', sha1.toUpperCase(), keychain], {
        timeoutMs: 300_000,
      });
      return code === 0 ? 'removed' : 'failed';
    },
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm vitest run src/main/platform && pnpm typecheck`
Expected: PASS. Any test double that implements the whole `PlatformAdapter` (search: `grep -rln "killLeftovers:" src --include=*.ts`) needs the two methods too: `trustRootCa: async () => 'trusted', untrustRootCa: async () => 'removed'`.

- [ ] **Step 7: Commit**

```bash
git add src/main/platform
git commit -m "feat(platform): add and remove NestBox's local CA in the user's trust store

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The domains service, channels and wiring

**Files:**
- Create: `src/main/domains/service.ts`, `src/main/domains/service.test.ts`
- Modify: `src/shared/ipc-names.ts`, `src/shared/channels.ts`, `src/shared/client.ts`, `src/main/ipc/core-handlers.ts`, `src/main/ipc/core-handlers.test.ts`, `src/main/index.ts`

**Interfaces:**
- Consumes: Tasks 2–8.
- Produces:
  - `interface DomainsService { status(): Promise<DomainsStatus>; setEnabled(enabled: boolean): Promise<DomainsStatus>; setPorts(p: { httpPort: number; httpsPort: number }): Promise<DomainsStatus>; setName(i: { projectId: string; label: string | null }): Promise<DomainsStatus>; setRewriteHost(i: { projectId: string; rewrite: boolean }): Promise<DomainsStatus>; trustCa(): Promise<TrustResult>; removeCa(): Promise<TrustResult>; refresh(): void; start(): Promise<void>; stop(): Promise<void> }`
  - `createDomainsService(deps: DomainsServiceDeps): DomainsService`
  - Channels `domains:status|setEnabled|setPorts|setName|setRewriteHost|trustCa|removeCa`, the event `domains:changed`, and `api.domains.*` in the client.

- [ ] **Step 1: Write the failing test** `src/main/domains/service.test.ts`

```ts
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DomainsSettingsSchema, type DomainsSettings } from '@shared/domains';
import { createMemoryLogger } from '../logger';
import { createLocalCa } from './ca';
import { createDomainsService, type DomainsService } from './service';

let service: DomainsService | null = null;
afterEach(async () => {
  await service?.stop();
  service = null;
});

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as AddressInfo;
  await new Promise((r) => s.close(r));
  return port;
}

async function setup(over: Partial<DomainsSettings> = {}) {
  let settings: DomainsSettings = { ...DomainsSettingsSchema.parse({}), httpPort: await freePort(), httpsPort: await freePort(), ...over };
  const trust = vi.fn(async (_file: string) => 'trusted' as const);
  const untrust = vi.fn(async () => 'removed' as const);
  const confirm = vi.fn(async (_kind: 'trust' | 'remove') => true);
  const emit = vi.fn();
  service = createDomainsService({
    settings: { get: () => settings, update: (fn) => void (settings = fn(settings)) },
    projects: async () => [{ id: 'r1', name: 'Shop', path: '/shop', workspaces: [] }],
    mainScript: () => null,
    processes: () => [],
    ports: async () => ({ rows: [], scannedAt: 0, stale: false }),
    detectedPort: async () => 5173,
    ca: createLocalCa({ file: join(await mkdtemp(join(tmpdir(), 'nestbox-svc-')), 'ca.json'), now: Date.now, logger: createMemoryLogger() }),
    trust: { trust, untrust },
    confirm,
    emit,
    logger: createMemoryLogger(),
    hosts: ['127.0.0.1'],
  });
  return { get: () => settings, trust, untrust, confirm, emit, service };
}

describe('domains service', () => {
  it('is off by default and starts both servers when turned on', async () => {
    const s = await setup();
    expect(await s.service.status()).toMatchObject({ enabled: false, http: { state: 'off' }, https: { state: 'off' } });
    const on = await s.service.setEnabled(true);
    expect(on).toMatchObject({ enabled: true, http: { state: 'running' }, https: { state: 'running' }, trust: 'none' });
    expect(on.routes).toEqual([{ name: 'shop.localhost', projectId: 'r1', script: null, port: 5173, source: 'detected', rewriteHost: false }]);
    expect(s.get().enabled).toBe(true);
    expect(s.emit).toHaveBeenCalled();
  });

  it('trusts after the confirmation, writing the root to a temporary file', async () => {
    const s = await setup({ enabled: true });
    await s.service.start();
    expect(await s.service.trustCa()).toEqual({ result: 'trusted' });
    expect(s.confirm).toHaveBeenCalledWith('trust');
    expect(s.trust.mock.calls[0]?.[0]).toMatch(/nestbox-ca-.*\.crt$/);
    expect(s.get().trust).toBe('trusted');
    s.confirm.mockResolvedValueOnce(false);
    expect(await s.service.trustCa()).toEqual({ result: 'cancelled' });
  });

  it('removes the CA from the store and the disk', async () => {
    const s = await setup({ enabled: true, trust: 'trusted' });
    expect(await s.service.removeCa()).toEqual({ result: 'removed' });
    expect(s.untrust).toHaveBeenCalled();
    expect(s.get().trust).toBe('none');
  });

  it('moves to new ports, and validates overrides', async () => {
    const s = await setup({ enabled: true });
    await s.service.start();
    const httpPort = await freePort();
    const httpsPort = await freePort();
    expect(await s.service.setPorts({ httpPort, httpsPort })).toMatchObject({ http: { port: httpPort, state: 'running' } });
    expect((await s.service.setName({ projectId: 'r1', label: 'store' })).routes[0]?.name).toBe('store.localhost');
    await expect(s.service.setName({ projectId: 'nope', label: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/main/domains/service.test.ts`
Expected: FAIL, "Failed to resolve import ./service".

- [ ] **Step 3: Write `src/main/domains/service.ts`**

```ts
// Local domains: keeps the route table current (rebuilt on process, port and project changes), runs the
// proxy while enabled, and owns the trust flow. The one place that touches the domains settings.
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DomainsSettings, DomainsStatus, ServerState, TrustResult } from '@shared/domains';
import { NestboxError } from '@shared/errors';
import type { PortList } from '@shared/ports';
import { isLive, type ProcessSummary } from '@shared/processes';
import type { Logger } from '../logger';
import type { LocalCa } from './ca';
import { createDomainsProxy } from './proxy';
import { buildRoutes, type RouteTable } from './router';

export interface DomainsProject {
  id: string;
  name: string;
  path: string;
  workspaces: readonly { id: string; name: string; relPath: string; path: string }[];
}

export interface DomainsServiceDeps {
  settings: { get(): DomainsSettings; update(fn: (s: DomainsSettings) => DomainsSettings): void };
  projects(): Promise<DomainsProject[]>;
  /** The package's main command (Scripts tool settings), or null. */
  mainScript(projectId: string): string | null;
  processes(): readonly ProcessSummary[];
  ports(): Promise<PortList>;
  /** .env's PORT, else the ecosystems' first detected port; null when neither. */
  detectedPort(projectId: string, dir: string): Promise<number | null>;
  ca: LocalCa;
  trust: {
    trust(certFile: string): Promise<'trusted' | 'cancelled' | 'failed'>;
    untrust(ids: { sha1: string; serialHex: string }): Promise<'removed' | 'failed'>;
  };
  /** The native confirmation; true = go ahead. */
  confirm(kind: 'trust' | 'remove'): Promise<boolean>;
  emit(): void;
  logger: Logger;
  hosts?: readonly string[];
}

export interface DomainsService {
  status(): Promise<DomainsStatus>;
  setEnabled(enabled: boolean): Promise<DomainsStatus>;
  setPorts(p: { httpPort: number; httpsPort: number }): Promise<DomainsStatus>;
  setName(i: { projectId: string; label: string | null }): Promise<DomainsStatus>;
  setRewriteHost(i: { projectId: string; rewrite: boolean }): Promise<DomainsStatus>;
  trustCa(): Promise<TrustResult>;
  removeCa(): Promise<TrustResult>;
  /** Process, port or project changes: rebuild soon (debounced). */
  refresh(): void;
  /** At startup: start the servers if enabled. */
  start(): Promise<void>;
  stop(): Promise<void>;
}

const EMPTY: RouteTable = { routes: [], clashes: [], byName: new Map() };
const REBUILD_MS = 200;
/** While a script runs, ports can open late (a dev server compiling): look again this often. */
const POLL_MS = 5_000;

export function createDomainsService(deps: DomainsServiceDeps): DomainsService {
  let table: RouteTable = EMPTY;
  const off = (port: number): ServerState => ({ state: 'off', port, code: null, owner: null });
  let servers: { http: ServerState; https: ServerState } = { http: off(deps.settings.get().httpPort), https: off(deps.settings.get().httpsPort) };
  const proxy = createDomainsProxy({ table: () => table, logger: deps.logger, ...(deps.hosts ? { hosts: deps.hosts } : {}) });
  let timer: NodeJS.Timeout | null = null;
  let poll: NodeJS.Timeout | null = null;

  async function rebuild(): Promise<void> {
    const settings = deps.settings.get();
    const projects = await deps.projects();
    // Overrides of removed projects are dropped here (no hook into project removal needed).
    const ids = new Set(projects.flatMap((p) => [p.id, ...p.workspaces.map((w) => w.id)]));
    const stale = [...Object.keys(settings.names), ...Object.keys(settings.rewriteHost)].filter((id) => !ids.has(id));
    if (stale.length > 0)
      deps.settings.update((s) => ({
        ...s,
        names: Object.fromEntries(Object.entries(s.names).filter(([id]) => ids.has(id))),
        rewriteHost: Object.fromEntries(Object.entries(s.rewriteHost).filter(([id]) => ids.has(id))),
      }));
    const processes = deps.processes();
    const ports = settings.enabled && processes.some((p) => isLive(p.state)) ? (await deps.ports()).rows : [];
    const mainScripts = new Map<string, string>();
    const detectedPorts = new Map<string, number>();
    for (const p of projects)
      for (const pkg of [{ id: p.id, path: p.path }, ...p.workspaces]) {
        const main = deps.mainScript(pkg.id);
        if (main) mainScripts.set(pkg.id, main);
        const detected = await deps.detectedPort(pkg.id, pkg.path).catch(() => null);
        if (detected !== null) detectedPorts.set(pkg.id, detected);
      }
    table = buildRoutes({
      projects,
      overrides: deps.settings.get().names,
      rewriteHost: deps.settings.get().rewriteHost,
      mainScripts,
      processes,
      ports,
      detectedPorts,
      ownPorts: [settings.httpPort, settings.httpsPort],
    });
    deps.emit();
  }

  async function ownerOf(state: ServerState): Promise<ServerState> {
    if (state.code !== 'EADDRINUSE') return state;
    const row = (await deps.ports().catch(() => null))?.rows.find((r) => r.port === state.port);
    const owner = row?.owner ? `${row.owner.projectId} · ${row.owner.script}` : (row?.processName ?? null);
    return { ...state, owner };
  }

  async function restart(): Promise<void> {
    const s = deps.settings.get();
    if (!s.enabled) {
      await proxy.stop();
      servers = { http: off(s.httpPort), https: off(s.httpsPort) };
      if (poll) clearInterval(poll);
      poll = null;
      return;
    }
    const started = await proxy.start({ httpPort: s.httpPort, httpsPort: s.httpsPort, sni: (name) => deps.ca.leaf(name) });
    servers = { http: await ownerOf(started.http), https: await ownerOf(started.https) };
    if (deps.ca.regenerated() && s.trust !== 'none') deps.settings.update((x) => ({ ...x, trust: 'none' }));
    poll ??= setInterval(() => {
      if (deps.processes().some((p) => isLive(p.state))) void rebuild();
    }, POLL_MS);
    await rebuild();
  }

  async function status(): Promise<DomainsStatus> {
    const s = deps.settings.get();
    return { enabled: s.enabled, http: servers.http, https: servers.https, trust: s.trust, routes: table.routes, clashes: table.clashes };
  }

  async function knownId(projectId: string) {
    const projects = await deps.projects();
    if (!projects.some((p) => p.id === projectId || p.workspaces.some((w) => w.id === projectId)))
      throw new NestboxError('NOT_FOUND', 'Project not found');
  }

  return {
    status: async () => {
      if (table === EMPTY) await rebuild();
      return status();
    },
    async setEnabled(enabled) {
      deps.settings.update((s) => ({ ...s, enabled }));
      await restart();
      deps.logger.info('domains toggled', { enabled });
      return status();
    },
    async setPorts({ httpPort, httpsPort }) {
      deps.settings.update((s) => ({ ...s, httpPort, httpsPort }));
      await restart();
      return status();
    },
    async setName({ projectId, label }) {
      await knownId(projectId);
      deps.settings.update((s) => {
        const names = { ...s.names };
        if (label === null) delete names[projectId];
        else names[projectId] = label;
        return { ...s, names };
      });
      await rebuild();
      return status();
    },
    async setRewriteHost({ projectId, rewrite }) {
      await knownId(projectId);
      deps.settings.update((s) => {
        const rewriteHost = { ...s.rewriteHost };
        if (rewrite) rewriteHost[projectId] = true;
        else delete rewriteHost[projectId];
        return { ...s, rewriteHost };
      });
      await rebuild();
      return status();
    },
    async trustCa() {
      if (!(await deps.confirm('trust'))) return { result: 'cancelled' };
      const file = join(tmpdir(), `nestbox-ca-${randomUUID()}.crt`);
      try {
        await writeFile(file, (await deps.ca.root()).cert);
        const result = await deps.trust.trust(file);
        deps.settings.update((s) => ({ ...s, trust: result === 'trusted' ? 'trusted' : 'untrusted' }));
        deps.logger.info('domains trust', { result });
        deps.emit();
        return { result };
      } finally {
        await rm(file, { force: true });
      }
    },
    async removeCa() {
      if (!(await deps.confirm('remove'))) return { result: 'cancelled' };
      const root = await deps.ca.root();
      const result = deps.settings.get().trust === 'none' ? 'removed' : await deps.trust.untrust(root);
      if (result === 'removed') {
        await deps.ca.reset();
        deps.settings.update((s) => ({ ...s, trust: 'none' }));
        if (deps.settings.get().enabled) await restart();
      }
      deps.logger.info('domains ca removed', { result });
      deps.emit();
      return { result };
    },
    refresh() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void rebuild().catch(() => {}), REBUILD_MS);
    },
    start: restart,
    async stop() {
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      timer = poll = null;
      await proxy.stop();
    },
  };
}
```

- [ ] **Step 4: Run the service tests**

Run: `pnpm vitest run src/main/domains/service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the channels**

`src/shared/ipc-names.ts`: add `'domains:status', 'domains:setEnabled', 'domains:setPorts', 'domains:setName', 'domains:setRewriteHost', 'domains:trustCa', 'domains:removeCa'` to `INVOKE_CHANNELS`, and `'domains:changed'` to `EVENT_CHANNELS`.

`src/shared/channels.ts` (imports from `./domains`):

```ts
  /** v1.30 local domains: servers, trust and the route table. */
  'domains:status': { input: NoInput, output: DomainsStatusSchema },
  'domains:setEnabled': { input: z.strictObject({ enabled: z.boolean() }), output: DomainsStatusSchema },
  'domains:setPorts': { input: DomainsPortsInputSchema, output: DomainsStatusSchema },
  'domains:setName': { input: DomainsNameInputSchema, output: DomainsStatusSchema },
  'domains:setRewriteHost': { input: DomainsRewriteInputSchema, output: DomainsStatusSchema },
  /** Shows a native confirmation in main first; command output never reaches the renderer. */
  'domains:trustCa': { input: NoInput, output: TrustResultSchema },
  'domains:removeCa': { input: NoInput, output: TrustResultSchema },
```

`src/shared/client.ts`, next to `ports`:

```ts
    domains: {
      status: () => call('domains:status'),
      setEnabled: (enabled: boolean) => call('domains:setEnabled', { enabled }),
      setPorts: (httpPort: number, httpsPort: number) => call('domains:setPorts', { httpPort, httpsPort }),
      setName: (projectId: string, label: string | null) => call('domains:setName', { projectId, label }),
      setRewriteHost: (projectId: string, rewrite: boolean) => call('domains:setRewriteHost', { projectId, rewrite }),
      trustCa: () => call('domains:trustCa'),
      removeCa: () => call('domains:removeCa'),
    },
```

`src/main/ipc/core-handlers.ts`: add `domains: Pick<DomainsService, 'status' | 'setEnabled' | 'setPorts' | 'setName' | 'setRewriteHost' | 'trustCa' | 'removeCa'>;` to `CoreHandlerDeps` and:

```ts
    'domains:status': () => deps.domains.status(),
    'domains:setEnabled': ({ enabled }) => deps.domains.setEnabled(enabled),
    'domains:setPorts': (input) => deps.domains.setPorts(input),
    'domains:setName': (input) => deps.domains.setName(input),
    'domains:setRewriteHost': (input) => deps.domains.setRewriteHost(input),
    'domains:trustCa': () => deps.domains.trustCa(),
    'domains:removeCa': () => deps.domains.removeCa(),
```

In `core-handlers.test.ts`, give the deps factory a `domains` fake (each method `vi.fn(async () => status)`), and add one test that `'domains:setPorts'` passes its input through. `register.test.ts` and `channels.test.ts` then check the new names automatically.

- [ ] **Step 6: Wire it in `src/main/index.ts`**, after `const ports = new PortService(...)`:

```ts
    const fakeTrust = !app.isPackaged && process.env['NESTBOX_FAKE_TRUST'] === '1';
    const domains = createDomainsService({
      settings: {
        get: () => store.getSettings().domains,
        update: (fn) => store.updateSettings((s) => ({ ...s, domains: fn(s.domains) })),
      },
      projects: async () =>
        (await projects.list()).map((p) => ({
          id: p.id,
          name: p.name,
          path: p.path,
          workspaces: p.detected.workspaces.map((w) => ({ id: w.id, name: w.name, relPath: w.relPath, path: w.path })),
        })),
      mainScript: (projectId) => {
        const { rootId, relPath } = splitProjectId(projectId);
        const parsed = scriptsDefinition.settingsSchema.safeParse(projects.getToolSettings(rootId, 'scripts') ?? {});
        return parsed.success ? (parsed.data.main.find((m) => m.relPath === relPath)?.script ?? null) : null;
      },
      processes: () => processes.list(),
      ports: () => ports.list(),
      detectedPort: async (projectId, dir) => {
        const text = await envFiles.read(dir, '.env').then((r) => r.text).catch(() => null);
        const port = text === null ? '' : (envEntries(parseEnv(text)).get('PORT')?.trim() ?? '');
        if (/^\d{1,5}$/.test(port) && Number(port) >= 1 && Number(port) <= 65_535) return Number(port);
        const { rootId } = splitProjectId(projectId);
        const detected = findDetected(projects.getDetected(rootId), projectId);
        return detected ? (ecosystemPorts(detected)[0] ?? null) : null;
      },
      ca: createLocalCa({ file: join(app.getPath('userData'), 'domains-ca.json'), now: Date.now, logger }),
      trust: fakeTrust
        ? { trust: async () => 'trusted', untrust: async () => 'removed' }
        : { trust: (file) => platform.trustRootCa(file), untrust: (ids) => platform.untrustRootCa(ids) },
      confirm: async (kind) => {
        const options =
          kind === 'trust'
            ? {
                type: 'question' as const,
                buttons: ['Trust', 'Not now'],
                defaultId: 0,
                cancelId: 1,
                message: 'Trust NestBox’s local certificate authority?',
                detail:
                  'NestBox made a certificate authority on this computer so https://<project>.localhost works without a browser warning. It can only vouch for names ending in .localhost, never for real websites. Your operating system will ask you to confirm next.',
              }
            : {
                type: 'warning' as const,
                buttons: ['Remove', 'Cancel'],
                defaultId: 1,
                cancelId: 1,
                message: 'Remove NestBox’s certificate authority?',
                detail: 'Local domains go back to untrusted HTTPS until you trust a new one.',
              };
        const result = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
        return result.response === 0;
      },
      emit: throttle(() => emit('domains:changed'), 250),
      logger,
    });
    processes.on((event) => {
      if (event.type === 'changed') domains.refresh();
    });
    void domains.start();
```

Then:
- call `domains.refresh()` inside `ProjectService`'s `onChanged` (next to `emit('projects:changed')`);
- pass `domains` into `createCoreHandlers({ ..., domains })`;
- in the quit controller's `shutdown`, add `domains.stop()` to the `Promise.allSettled([...])` list.

Check the names `projects.getDetected`, `splitProjectId`, `findDetected`, `envEntries`, `parseEnv`, `envFiles` against the file (the Inspector's `resolveTarget` uses the same `.env` reading) and import what's missing: `createDomainsService` from `./domains/service`, `createLocalCa` from `./domains/ca`, `scriptsDefinition` from `@shared/tools/scripts/contract`, `ecosystemPorts` from `./ecosystems`. If `ProjectService` has no `getDetected`, use the summary list: `(await projects.list()).find((p) => p.id === rootId)?.detected`.

- [ ] **Step 7: Run every check**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS apart from the 3 known `win32.integration` failures on the owner's machine.

- [ ] **Step 8: Commit**

```bash
git add src/main/domains/service.ts src/main/domains/service.test.ts src/shared/ipc-names.ts src/shared/channels.ts src/shared/client.ts src/main/ipc src/main/index.ts
git commit -m "feat(domains): service, core channels and wiring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Settings section

**Files:**
- Create: `src/renderer/domains/use-domains.ts`, `src/renderer/domains/DomainsSettings.tsx`, `src/renderer/domains/DomainsSettings.test.tsx`
- Modify: `src/renderer/lib/queries.ts` (`queryKeys.domains`), `src/renderer/app/SettingsDialog.tsx`

**Interfaces:**
- Consumes: `api.domains.*` and the `domains:changed` event (Task 9).
- Produces: `useDomainsStatus(): UseQueryResult<DomainsStatus>` (refetches on `domains:changed`); `useDomainsActions(): { setEnabled; setPorts; setName; setRewriteHost; trust; remove }` (mutations that write the returned status into the query cache); `<DomainsSettings />`.

- [ ] **Step 1: Write the failing test** `src/renderer/domains/DomainsSettings.test.tsx`

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DomainsStatus } from '@shared/domains';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { DomainsSettings } from './DomainsSettings';

const status = (over: Partial<DomainsStatus> = {}): DomainsStatus => ({
  enabled: false,
  http: { state: 'off', port: 80, code: null, owner: null },
  https: { state: 'off', port: 443, code: null, owner: null },
  trust: 'none',
  routes: [],
  clashes: [],
  ...over,
});

describe('DomainsSettings', () => {
  it('turns domains on and asks main to trust the CA the first time', async () => {
    const calls: string[] = [];
    let current = status();
    installMockBridge({
      'domains:status': () => current,
      'domains:setEnabled': ({ enabled }: { enabled: boolean }) => {
        calls.push(`enabled:${enabled}`);
        current = status({ enabled, http: { state: 'running', port: 80, code: null, owner: null }, https: { state: 'running', port: 443, code: null, owner: null } });
        return current;
      },
      'domains:trustCa': () => {
        calls.push('trust');
        current = { ...current, trust: 'trusted' };
        return { result: 'trusted' };
      },
    } as never);
    renderWithProviders(<DomainsSettings />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Local domains' }));
    await waitFor(() => expect(calls).toEqual(['enabled:true', 'trust']));
    expect(await screen.findByText('Trusted')).toBeInTheDocument();
  });

  it("shows why a server couldn't start", async () => {
    installMockBridge({
      'domains:status': () =>
        status({ enabled: true, https: { state: 'failed', port: 443, code: 'EADDRINUSE', owner: 'httpd.exe' }, trust: 'trusted' }),
    } as never);
    renderWithProviders(<DomainsSettings />);
    expect(await screen.findByText('Port 443 is in use by httpd.exe')).toBeInTheDocument();
  });

  it('saves new ports and refuses equal ones', async () => {
    const seen: unknown[] = [];
    installMockBridge({
      'domains:status': () => status({ enabled: true }),
      'domains:setPorts': (input: unknown) => {
        seen.push(input);
        return status({ enabled: true });
      },
    } as never);
    renderWithProviders(<DomainsSettings />);
    const http = await screen.findByLabelText('HTTP port');
    await userEvent.clear(http);
    await userEvent.type(http, '443');
    expect(screen.getByRole('button', { name: 'Apply ports' })).toBeDisabled();
    await userEvent.clear(http);
    await userEvent.type(http, '8080');
    await userEvent.click(screen.getByRole('button', { name: 'Apply ports' }));
    await waitFor(() => expect(seen).toEqual([{ httpPort: 8080, httpsPort: 443 }]));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run --project renderer src/renderer/domains`
Expected: FAIL, "Failed to resolve import ./DomainsSettings".

- [ ] **Step 3: Write `src/renderer/domains/use-domains.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import type { DomainsStatus } from '@shared/domains';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';

/** The domains status; main pushes domains:changed when routes, servers or trust change. */
export function useDomainsStatus() {
  const queryClient = useQueryClient();
  useEffect(
    () => api.on('domains:changed', () => void queryClient.invalidateQueries({ queryKey: queryKeys.domains })),
    [queryClient],
  );
  return useQuery({ queryKey: queryKeys.domains, queryFn: () => api.domains.status() });
}

export function useDomainsActions() {
  const queryClient = useQueryClient();
  const put = (status: DomainsStatus) => queryClient.setQueryData(queryKeys.domains, status);
  const refetch = () => void queryClient.invalidateQueries({ queryKey: queryKeys.domains });
  const onError = (error: unknown) => toast.error(errorMessage(error));
  return {
    setEnabled: useMutation({ mutationFn: (enabled: boolean) => api.domains.setEnabled(enabled), onSuccess: put, onError }),
    setPorts: useMutation({ mutationFn: (p: { httpPort: number; httpsPort: number }) => api.domains.setPorts(p.httpPort, p.httpsPort), onSuccess: put, onError }),
    setName: useMutation({ mutationFn: (i: { projectId: string; label: string | null }) => api.domains.setName(i.projectId, i.label), onSuccess: put, onError }),
    setRewriteHost: useMutation({ mutationFn: (i: { projectId: string; rewrite: boolean }) => api.domains.setRewriteHost(i.projectId, i.rewrite), onSuccess: put, onError }),
    trust: useMutation({ mutationFn: () => api.domains.trustCa(), onSettled: refetch, onError }),
    remove: useMutation({ mutationFn: () => api.domains.removeCa(), onSettled: refetch, onError }),
  };
}
```

In `src/renderer/lib/queries.ts`, add `domains: ['domains'] as const,` to `queryKeys`. If `api.on` doesn't return an unsubscribe function, follow how `processes:changed` is subscribed in that file.

- [ ] **Step 4: Write `src/renderer/domains/DomainsSettings.tsx`**

```tsx
import { useState } from 'react';
import type { ServerState } from '@shared/domains';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useDomainsActions, useDomainsStatus } from './use-domains';

function serverLine(label: string, s: ServerState): string {
  if (s.state === 'running') return `${label} on port ${s.port}`;
  if (s.state === 'off') return `${label} off`;
  if (s.code === 'EADDRINUSE') return s.owner ? `Port ${s.port} is in use by ${s.owner}` : `Port ${s.port} is in use`;
  if (s.code === 'EACCES') return `Not allowed to use port ${s.port}`;
  return `${label} couldn't start (${s.code ?? 'unknown'})`;
}

const TRUST_LABEL = { none: 'Not trusted yet', trusted: 'Trusted', untrusted: 'Not trusted' } as const;

export function DomainsSettings() {
  const { data } = useDomainsStatus();
  const actions = useDomainsActions();
  const [http, setHttp] = useState<string | null>(null);
  const [https, setHttps] = useState<string | null>(null);
  if (!data) return null;
  const httpPort = Number(http ?? data.http.port);
  const httpsPort = Number(https ?? data.https.port);
  const valid = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65_535;
  const portsOk = valid(httpPort) && valid(httpsPort) && httpPort !== httpsPort;
  const portsChanged = httpPort !== data.http.port || httpsPort !== data.https.port;

  return (
    <section aria-label="Local domains" className="space-y-3 rounded-md border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">Local domains</p>
          <p className="text-xs text-fg-muted">Reach projects at https://&lt;name&gt;.localhost instead of a port.</p>
        </div>
        <Switch
          aria-label="Local domains"
          checked={data.enabled}
          onCheckedChange={(enabled) =>
            actions.setEnabled.mutate(enabled, {
              onSuccess: (status) => {
                if (enabled && status.trust === 'none') actions.trust.mutate();
              },
            })
          }
        />
      </div>
      {data.enabled && (
        <>
          <ul className="space-y-0.5 text-xs">
            {[serverLine('HTTPS', data.https), serverLine('HTTP', data.http)].map((line) => (
              <li key={line} className={line.includes('in use') || line.includes("couldn't") || line.includes('Not allowed') ? 'text-warn' : 'text-fg-muted'}>
                {line}
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <label className="text-xs text-fg-muted">
              HTTP port
              <Input aria-label="HTTP port" className="mt-1 h-7 w-24 text-xs" value={http ?? String(data.http.port)} onChange={(e) => setHttp(e.target.value)} />
            </label>
            <label className="text-xs text-fg-muted">
              HTTPS port
              <Input aria-label="HTTPS port" className="mt-1 h-7 w-24 text-xs" value={https ?? String(data.https.port)} onChange={(e) => setHttps(e.target.value)} />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={!portsOk || !portsChanged || actions.setPorts.isPending}
              onClick={() => actions.setPorts.mutate({ httpPort, httpsPort }, { onSuccess: () => { setHttp(null); setHttps(null); } })}
            >
              Apply ports
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={data.trust === 'trusted' ? 'text-ok' : 'text-warn'}>{TRUST_LABEL[data.trust]}</span>
            {data.trust !== 'trusted' && (
              <Button size="sm" variant="secondary" onClick={() => actions.trust.mutate()}>
                {data.trust === 'none' ? 'Trust' : 'Trust again'}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => actions.remove.mutate()}>
              Remove NestBox's certificate authority
            </Button>
          </div>
          <p className="text-[11px] text-fg-faint">
            Browsers only: backends should keep calling localhost:&lt;port&gt;. Next.js may need the name in allowedDevOrigins.
            Firefox: allow third-party root certificates in Settings → Privacy &amp; Security → Certificates.
          </p>
        </>
      )}
    </section>
  );
}
```

Use the token class names that `globals.css` defines for "ok" and "warn" text (check: `grep -n "\-\-nb-ok\|text-ok\|--color-ok" src/renderer/styles/globals.css`). If there's no `ok` token, use `text-fg`.

- [ ] **Step 5: Mount it** in `SettingsDialog.tsx`: render `<DomainsSettings />` inside `SettingsForm`'s `fieldset`, after the existing rows, but **outside** the form's save logic (it applies at once through its own mutations). Import it from `@/domains/DomainsSettings`.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run --project renderer src/renderer/domains src/renderer/app/SettingsDialog.test.tsx`
Expected: PASS. `SettingsDialog.test.tsx` may need `'domains:status'` in its mock bridge; add a handler returning the `status()` fixture shape.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/domains src/renderer/lib/queries.ts src/renderer/app/SettingsDialog.tsx src/renderer/app/SettingsDialog.test.tsx
git commit -m "feat(domains): Settings section with servers, ports and trust

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Header link, project dialog, Ports column and palette

**Files:**
- Create: `src/renderer/domains/DomainLink.tsx`, `src/renderer/domains/DomainLink.test.tsx`, `src/renderer/domains/LocalDomainDialog.tsx`, `src/renderer/domains/LocalDomainDialog.test.tsx`
- Modify: `src/renderer/app/ProjectHeader.tsx`, `src/renderer/ports/PortsPage.tsx`, `src/renderer/ports/PortsPage.test.tsx`, `src/renderer/app/palette-entries.ts`, `src/renderer/app/palette-entries.test.ts`, `src/renderer/app/CommandPalette.tsx`

**Interfaces:**
- Consumes: `useDomainsStatus`, `useDomainsActions` (Task 10).
- Produces:
  - `domainUrl(status: DomainsStatus, name: string): string`: `https://` while HTTPS runs (else `http://`), with `:<port>` unless it's 443/80;
  - `<DomainLink projectId />`;
  - `<LocalDomainDialog projectId open onOpenChange />`;
  - the palette action `{ kind: 'url'; url: string }` and the `PaletteInput.domains?: readonly { projectId: string; name: string; url: string }[]` field.

- [ ] **Step 1: Write the failing tests**

`src/renderer/domains/DomainLink.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DomainsStatus } from '@shared/domains';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { DomainLink, domainUrl } from './DomainLink';

const running = { state: 'running' as const, code: null, owner: null };
const status = (over: Partial<DomainsStatus> = {}): DomainsStatus => ({
  enabled: true,
  http: { ...running, port: 80 },
  https: { ...running, port: 443 },
  trust: 'trusted',
  routes: [{ name: 'shop.localhost', projectId: 'p1', script: 'dev', port: 5173, source: 'main', rewriteHost: false }],
  clashes: [],
  ...over,
});

describe('domainUrl', () => {
  it('prefers HTTPS and drops default ports', () => {
    expect(domainUrl(status(), 'shop.localhost')).toBe('https://shop.localhost');
    expect(domainUrl(status({ https: { ...running, port: 8443 } }), 'shop.localhost')).toBe('https://shop.localhost:8443');
    expect(domainUrl(status({ https: { state: 'failed', port: 443, code: 'EADDRINUSE', owner: null } }), 'shop.localhost')).toBe('http://shop.localhost');
  });
});

describe('DomainLink', () => {
  it('opens the URL through main', async () => {
    const opened: unknown[] = [];
    installMockBridge({ 'domains:status': () => status(), 'app:openExternal': (i: unknown) => void opened.push(i) } as never);
    renderWithProviders(<DomainLink projectId="p1" />);
    await userEvent.click(await screen.findByRole('link', { name: 'https://shop.localhost' }));
    expect(opened).toEqual([{ url: 'https://shop.localhost' }]);
  });

  it('is greyed out with a reason when nothing runs, and hidden while domains are off', async () => {
    installMockBridge({
      'domains:status': () => status({ routes: [{ name: 'shop.localhost', projectId: 'p1', script: null, port: null, source: 'none', rewriteHost: false }] }),
    } as never);
    const { unmount } = renderWithProviders(<DomainLink projectId="p1" />);
    expect(await screen.findByText('https://shop.localhost')).toHaveAttribute('aria-disabled', 'true');
    unmount();
    installMockBridge({ 'domains:status': () => status({ enabled: false }) } as never);
    renderWithProviders(<DomainLink projectId="p1" />);
    await expect(screen.findByText(/shop\.localhost/, {}, { timeout: 300 })).rejects.toThrow();
  });
});
```

`src/renderer/domains/LocalDomainDialog.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { LocalDomainDialog } from './LocalDomainDialog';

describe('LocalDomainDialog', () => {
  it('validates and saves a label, and switches the Host rewrite', async () => {
    const seen: unknown[] = [];
    const status = {
      enabled: true,
      http: { state: 'running', port: 80, code: null, owner: null },
      https: { state: 'running', port: 443, code: null, owner: null },
      trust: 'trusted',
      routes: [{ name: 'shop.localhost', projectId: 'p1', script: null, port: null, source: 'none', rewriteHost: false }],
      clashes: [],
    };
    installMockBridge({
      'domains:status': () => status,
      'domains:setName': (i: unknown) => (seen.push(i), status),
      'domains:setRewriteHost': (i: unknown) => (seen.push(i), status),
    } as never);
    renderWithProviders(<LocalDomainDialog projectId="p1" open onOpenChange={() => {}} />);
    const input = await screen.findByLabelText('Name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Bad Name');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'store');
    await userEvent.click(screen.getByRole('switch', { name: 'Rewrite the Host header' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(seen).toEqual([{ projectId: 'p1', rewrite: true }, { projectId: 'p1', label: 'store' }]));
  });
});
```

In `palette-entries.test.ts`, add:

```ts
  it('offers to open each local domain with a port', () => {
    const entries = paletteEntries({
      projects: [],
      selected: null,
      processes: [],
      runGroups: [],
      tools: [],
      domains: [{ projectId: 'p1', name: 'shop.localhost', url: 'https://shop.localhost' }],
    });
    expect(entries).toContainEqual(
      expect.objectContaining({ label: 'Open shop.localhost', action: { kind: 'url', url: 'https://shop.localhost' } }),
    );
  });
```

In `PortsPage.test.tsx`, add `'domains:status'` to the mock bridge returning a route for one of the fixture rows' owner, and assert the "Domain" column cell shows `shop.localhost`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run --project renderer src/renderer/domains src/renderer/app/palette-entries.test.ts src/renderer/ports`
Expected: FAIL (missing modules, no `url` entries, no Domain column).

- [ ] **Step 3: Write `src/renderer/domains/DomainLink.tsx`**

```tsx
import { Copy } from 'lucide-react';
import type { DomainsStatus } from '@shared/domains';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useDomainsStatus } from './use-domains';

export function domainUrl(status: DomainsStatus, name: string): string {
  const https = status.https.state === 'running';
  const port = https ? status.https.port : status.http.port;
  const suffix = (https && port === 443) || (!https && port === 80) ? '' : `:${port}`;
  return `${https ? 'https' : 'http'}://${name}${suffix}`;
}

/** The project's local domain in the header: a link while it routes somewhere, greyed out otherwise. */
export function DomainLink({ projectId }: { projectId: string }) {
  const { data } = useDomainsStatus();
  // The project's own route comes first: buildRoutes pushes it before its extra servers' routes.
  const route = data?.enabled ? data.routes.find((r) => r.projectId === projectId) : undefined;
  if (!data || !route) return null;
  const url = domainUrl(data, route.name);
  if (route.port === null)
    return (
      <span aria-disabled="true" title="Start the project's main command to use its local domain" className="text-fg-faint">
        {url}
      </span>
    );
  return (
    <span className="flex items-center gap-1">
      <a
        href={url}
        className="text-fg underline-offset-2 hover:underline"
        onClick={(e) => {
          e.preventDefault();
          void api.app.openExternal(url);
        }}
      >
        {url}
      </a>
      <Button variant="ghost" size="icon" className="size-5" aria-label="Copy local domain" onClick={() => void navigator.clipboard.writeText(url)}>
        <Copy className="size-3" aria-hidden />
      </Button>
    </span>
  );
}
```

Check that `api.app.openExternal` is the client's name for `app:openExternal` (`src/shared/client.ts`).

- [ ] **Step 4: Write `src/renderer/domains/LocalDomainDialog.tsx`**

```tsx
import { useState } from 'react';
import { LABEL } from '@shared/domains';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useDomainsActions, useDomainsStatus } from './use-domains';

export function LocalDomainDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange(open: boolean): void }) {
  const { data } = useDomainsStatus();
  const actions = useDomainsActions();
  const route = data?.routes.find((r) => r.projectId === projectId);
  const current = route?.name.split('.')[0] ?? '';
  const [label, setLabel] = useState<string | null>(null);
  const [rewrite, setRewrite] = useState<boolean | null>(null);
  const rewriteNow = rewrite ?? route?.rewriteHost ?? false;
  const value = label ?? current;
  const ok = LABEL.test(value);
  const clash = data?.clashes.includes(projectId) ?? false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Local domain</DialogTitle>
        </DialogHeader>
        <label className="block text-xs text-fg-muted">
          Name
          <Input aria-label="Name" className="mt-1 h-8 text-sm" value={value} onChange={(e) => setLabel(e.target.value)} />
        </label>
        {!ok && <p className="text-xs text-warn">Lowercase letters, digits and dashes; no dash at either end.</p>}
        {clash && <p className="text-xs text-warn">Another project has this name, so a number was added.</p>}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-fg">Rewrite the Host header</p>
            <p className="text-xs text-fg-muted">Only if the app refuses unknown host names: it then sees localhost:&lt;port&gt;.</p>
          </div>
          <Switch aria-label="Rewrite the Host header" checked={rewriteNow} onCheckedChange={setRewrite} />
        </div>
        <DialogFooter>
          <Button
            disabled={!ok || actions.setName.isPending}
            onClick={async () => {
              if (rewrite !== null && rewrite !== route?.rewriteHost) await actions.setRewriteHost.mutateAsync({ projectId, rewrite });
              if (label !== null && label !== current) await actions.setName.mutateAsync({ projectId, label });
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Wire the header and the menu** in `ProjectHeader.tsx`:
  - render `<DomainLink projectId={detected.id} />` after the path span;
  - add `const [domainOpen, setDomainOpen] = useState(false);`;
  - add a `DropdownMenuItem` "Local domain…" (`onSelect={() => setDomainOpen(true)}`), shown when `useDomainsStatus().data?.enabled`;
  - render `<LocalDomainDialog projectId={detected.id} open={domainOpen} onOpenChange={setDomainOpen} />`.
  
  `ProjectHeader.test.tsx`'s mock bridge needs `'domains:status': () => ({ ...status, enabled: false })` (copy the `status` helper from `DomainLink.test.tsx`).

- [ ] **Step 6: Add the Ports column** in `PortsPage.tsx`: read `useDomainsStatus()`, build `const domainOf = (port: number) => data?.enabled ? data.routes.find((r) => r.port === port)?.name ?? null : null;`, add `<th className="w-44 py-1.5 font-semibold">Domain</th>` after "Owner", and render `<td className="font-mono text-xs">{domainOf(row.port) ?? ''}</td>` in each row.

- [ ] **Step 7: Add the palette entries.** In `palette-entries.ts`:
  - add `| { kind: 'url'; url: string }` to the action union;
  - add `domains?: readonly { projectId: string; name: string; url: string }[]` to `PaletteInput` (destructured with default `[]`);
  - before returning, push `{ id: \`url:${d.name}\`, label: \`Open ${d.name}\`, keywords: ['domain', 'localhost'], action: { kind: 'url', url: d.url } }` for each, matching the existing entries' shape (check `PaletteEntry`'s other required fields, such as a group or section, and fill them like the `ports` entry).
  
  In `CommandPalette.tsx`:
  - pass `domains` built from `useDomainsStatus()`: `data?.enabled ? data.routes.filter((r) => r.port !== null).map((r) => ({ projectId: r.projectId, name: r.name, url: domainUrl(data, r.name) })) : []`;
  - handle `case 'url': void api.app.openExternal(entry.action.url); break;`.

- [ ] **Step 8: Run the renderer tests**

Run: `pnpm vitest run --project renderer`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/renderer
git commit -m "feat(domains): header link, Local domain dialog, Ports column and palette entries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: End to end, docs, version

**Files:**
- Create: `e2e/domains.spec.ts`
- Modify: `e2e/helpers.ts` (`launch` passes `NESTBOX_FAKE_TRUST`), `CLAUDE.md`, `README.md`, `package.json` (1.30.0), `docs/superpowers/HANDOFF.md`

- [ ] **Step 1: Let `launch` stub trust.** In `e2e/helpers.ts`, add an option `fakeTrust?: boolean` and, when set, `NESTBOX_FAKE_TRUST: '1'` in the env object (next to `NESTBOX_USER_DATA_DIR`).

- [ ] **Step 2: Write `e2e/domains.spec.ts`**

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let userData = '';
let apiPort = 0;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function get(port: number, host: string): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/', headers: { host } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, ...(res.headers.location ? { location: res.headers.location } : {}) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test.beforeEach(async () => {
  const project = await copyFixture('echo-api');
  apiPort = await freePort();
  await writeFile(join(project, '.env'), `PORT=${apiPort}\n`);
  ({ app, page, userData } = await launch(project, { fakeTrust: true }));
});

test.afterEach(async () => {
  await app.close();
});

test('routes a running project through its local domain over HTTP and trusted HTTPS', async () => {
  const httpPort = await freePort();
  const httpsPort = await freePort();
  await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'Add project' }).click();
  // Set the ports before turning it on (80/443 can't be counted on in CI).
  await page.evaluate(
    ([h, s]) => (globalThis as unknown as { nestbox: { invoke(c: string, i: unknown): Promise<unknown> } }).nestbox.invoke('domains:setPorts', { httpPort: h, httpsPort: s }),
    [httpPort, httpsPort],
  );
  await page.keyboard.press('Control+,'); // or open Settings the way theme.spec.ts does
  await page.getByRole('switch', { name: 'Local domains' }).click();
  await expect(page.getByText('Trusted')).toBeVisible();
  await page.keyboard.press('Escape');

  // Start the API (the echo-api fixture's serve script listens on PORT).
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'Start serve' }).click();
  const name = 'nestbox-e2e-echo-api.localhost';
  await expect.poll(async () => (await get(httpPort, name)).status, { timeout: 30_000 }).toBe(308);
  expect((await get(httpPort, name)).location).toBe(`https://${name}:${httpsPort}/`);

  const ca = JSON.parse(await readFile(join(userData, 'domains-ca.json'), 'utf8')) as { root: { cert: string } };
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpsRequest({ host: '127.0.0.1', port: httpsPort, servername: name, ca: ca.root.cert, headers: { host: name }, path: '/' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
  expect(status).toBe(200);
  await expect(page.getByRole('link', { name: `https://${name}:${httpsPort}` })).toBeVisible();
});
```

Before running it, check two names against existing specs: how Settings is opened (`theme.spec.ts`/`tool-toggles.spec.ts`), and the Scripts tab's start button label (`scripts.spec.ts`). Use the same locators. If `domains:setPorts` must run after enabling, swap the order; the service persists ports either way.

- [ ] **Step 3: Run the e2e spec**

Run: `pnpm build && pnpm e2e -- domains.spec.ts`
Expected: PASS (on Linux: `xvfb-run -a pnpm e2e -- domains.spec.ts`).

- [ ] **Step 4: Docs and version**
  - `package.json`: `"version": "1.30.0"`.
  - `CLAUDE.md`:
    - Folder structure: add `domains/      local domains: names, router, proxy, local CA, service (core, machine-wide)` and `net/          proxy helpers shared by the Inspector and domains`.
    - A **Local domains (v1.30)** gotcha summarising: names (`<label>.localhost`, workspace `<pkg>.<root>.localhost`, overrides and clashes); the target order (main → earliest running script → `.env` PORT/detected → none); the 403/404/503/502 pages; Host kept or rewritten; `X-Forwarded-*`; upgrades piped; HTTP → 308 while HTTPS runs; loopback only, no fallback ports; the CA (`domains-ca.json`, name-constrained to `.localhost`, leaves per host via SNI, keys never logged); trust through `trustRootCa`/`untrustRootCa` (certutil user store, the `security` login keychain) after a native confirmation; `NESTBOX_FAKE_TRUST` (unpackaged only); and the limits (server-to-server calls, `allowedDevOrigins`, Firefox).
    - The IPC section: "Core channels added in v1.30: `domains:*` …".
  - `README.md`: a feature row "**Local domains**" (stable `https://<name>.localhost` URLs, trusted HTTPS from a CA limited to `.localhost`, WebSockets for hot reload, opt-in in Settings), and a `| v1.30.0 | Local domains |` row under Shipped.
  - `docs/superpowers/HANDOFF.md`: the current state row for 1.30.0.

- [ ] **Step 5: Full verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`
Expected: all pass apart from the 3 known local `win32.integration` failures.

- [ ] **Step 6: Manual checks on the owner's Windows machine** (can't run in CI). Record the results in the PR description.
  - [ ] Turn domains on with 80/443: Windows shows its certificate dialog; after Yes, `https://<project>.localhost` opens in Edge and Chrome without a warning.
  - [ ] Firefox: does it trust the root (user store) without the setting? Note the answer; if not, check that the hint's steps work.
  - [ ] A Vite dev server's hot reload works through `https://<name>.localhost` (WebSocket through the proxy).
  - [ ] "Remove NestBox's certificate authority" removes it (`certmgr.msc` → Trusted Root → no "NestBox Local CA").
  - [ ] Something already on port 443 (e.g. `npx http-server -p 443`): the status names it.

- [ ] **Step 7: Commit and open the PR**

```bash
git add e2e CLAUDE.md README.md package.json docs/superpowers/HANDOFF.md
git commit -m "test(domains): end to end through the proxy; docs and 1.30.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin local-domains
gh pr create --draft --title "feat: local domains (#85)" --body "Closes #85. Spec and plan in docs/superpowers. …

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review notes

- **Spec coverage:**
  - names (§1) → Tasks 3–4;
  - proxy, redirect, upgrades and pages (§2) → Tasks 5–6;
  - CA, leaves and storage (§3) → Task 7; trust → Tasks 8–9;
  - settings and channels (§4) → Tasks 2 and 9;
  - UI (§5) → Tasks 10–11;
  - errors (§6) → Tasks 5–9;
  - limits (§7) → Task 10's hint and Task 12's docs;
  - testing (§8) → every task plus Task 12;
  - delivery → Task 12.
- **Type consistency:** `Route.rewriteHost` (Task 2) is set by `buildRoutes` (Task 4) and read by the dialog (Task 11); `RouteTarget` adds only `ipv6Only`. The service and UI use the `DomainsStatus` shape from Task 2 throughout.
- **Placeholders:** the "check the name in the file" notes (Task 9 wiring, Task 10 tokens, Task 11 palette fields, Task 12 locators) point at existing code to match, not at missing design.
