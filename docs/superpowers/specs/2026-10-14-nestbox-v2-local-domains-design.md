# NestBox v2: local domains (design)

Issue #85. **Status: design, for the owner's review.** No implementation plan yet; that follows approval (`docs/superpowers/plans/`).

## Goal

Reach every project at a stable name such as `https://shop.localhost`, whichever port its dev server picked today.

The owner's goals (2026-10-14):

1. **Stable, memorable URLs.** Bookmarks and OAuth callback URLs survive port changes.
2. **Cookie and storage isolation.** `localhost:3000` and `localhost:3001` share cookies; separate host names don't.
3. **Trusted HTTPS.** No browser warning, so secure cookies, service workers and HTTPS-only OAuth providers work.

**Out of scope:** reaching projects from the LAN or a phone (the proxy binds loopback only), and making server-to-server calls through the names work (see Limits).

## Decisions

| Question | Decision |
| --- | --- |
| Where it lives | A **core service** in main (`src/main/domains/`), machine-wide like Ports, not a per-project tool. Not external software (Caddy, mkcert). |
| Ports | HTTP **80** and HTTPS **443** by default, **set in Settings**, with no automatic fallback. |
| Routing | The **main command's** port, else the first running script's, else the **detected** port. Other running servers get `<script>.<name>.localhost`. |
| Host header | **Kept** (`shop.localhost`), with `X-Forwarded-*` added. A per-project switch rewrites it to `localhost:<port>` for apps that refuse unknown hosts. |
| HTTPS trust | A **local CA, name-constrained to `.localhost`**, added to the user's trust store after NestBox's own confirmation. |

## 1. Names and routing (`domains/names.ts`, `domains/router.ts`, pure)

**Labels.**
- A project's label is its display name made into a host label: lowercase, characters other than `[a-z0-9-]` become `-`, repeated dashes and dashes at the ends are trimmed, at most 63 characters. An empty result falls back to `project`.
- A workspace package is `<package>.<root>.localhost`. The package label comes from its own name with any npm scope dropped (`@shop/api` → `api`), else its folder's last path part.
- Overrides: `AppSettings.domains.names[projectId]`, validated by the same label rule.
- Clashes: the later project in sidebar order gets `-2`, `-3`, … and Settings shows a warning on it.

**Targets.** The router is built from the projects (with their detected ecosystems), the port list (`PortService`, which attributes listening ports to `{ projectId, script }`) and the settings. For a name:

1. the port the package's **main command** listens on (`toolSettings.scripts.main[relPath]`, attributed by `PortService`);
2. else the lowest listening port of its **first running script** (the Scripts list's order);
3. else the **detected** port: `PORT` from the package's `.env`, then `ecosystemPorts` (the same order as the Inspector's fallback);
4. else **none**: the "not running" page.

Every other running script of the package with a listening port gets `<script>.<name>.localhost`. A script name that isn't a valid label is turned into one by the same rule.

**Requests the router refuses.**
- A `Host` outside `.localhost` (or a bare `localhost`) gets **403**: protection against DNS rebinding, as in the Inspector.
- A name under `.localhost` that matches nothing gets **404**, with a page listing the known names.

**Rebuilding.** The route table is rebuilt (debounced 200 ms) on `processes:changed`, on `projects:changed` and when the port service's cache refreshes. The proxy only reads the current table, so a request never waits on a port scan. A target port of 0 or one that equals the proxy's own ports is ignored.

Each route records **why** it has its port (`main`/`script`/`detected`/`none`) for the UI.

## 2. Proxy (`domains/proxy.ts`)

**Servers.**
- One `node:http` server on `httpPort` and one `node:https` server on `httpsPort`, each bound to `127.0.0.1` and `::1`.
- A bind error (`EADDRINUSE`, `EACCES`) marks that server `failed` with the code, and the other one keeps going. For `EADDRINUSE` the status also names the port's owner from `PortService` (the process name, or a NestBox script).
- No fallback port. A new attempt happens when the port setting changes or the feature is turned off and on.

**Forwarding.**
- Requests and responses are streamed to `http://127.0.0.1:<port>`, or `http://[::1]:<port>` when the port row says it listens only on IPv6.
- There is no recording, no body cap and no overall timeout: dev servers keep requests open (server-sent events, long builds). Connect errors (`ECONNREFUSED`, `ECONNRESET` before headers) give a **502** page naming the project and the port.
- Headers are built by `src/main/net/forward.ts`, moved out of `tools/inspector/proxy.ts` and shared with it:
  - hop-by-hop headers dropped;
  - `X-Forwarded-Host`, `X-Forwarded-Proto` (`http`/`https`) and `X-Forwarded-For` added;
  - `Host` kept, or rewritten to `localhost:<port>` when the project's switch is on.
- **WebSocket upgrades:** on `upgrade`, `net.connect` to the target, write the request line and the forwarded headers, then pipe both sockets. Errors close both sides. The Inspector keeps its 501 for now.
- **HTTP while HTTPS runs:** `308` to the same URL on HTTPS (with `:<httpsPort>` unless it's 443). While the HTTPS server isn't running, HTTP serves.

**Pages.** The 404, 502 and not-running pages and the 403 are small inline HTML pages using the app's token colours (as literal CSS in main, not renderer tokens). The not-running page has a link (`nestbox://` isn't registered, so it's a plain explanation plus the project's name). Pages never echo request paths or headers.

## 3. HTTPS and the local CA (`domains/ca.ts`)

**Root.**
- Subject `NestBox Local CA`, 10 years, RSA 2048 with SHA-256, `basicConstraints cA: true` (critical), `keyUsage keyCertSign, cRLSign`.
- **Name constraints: permitted DNS subtree `localhost`** (critical). A leaked key still can't produce a certificate any browser accepts for a real site.
- Generated with `selfsigned` (already a dependency) if it can add the name-constraints extension, else with `@peculiar/x509` directly (installed through `selfsigned` today; it would become a direct main dependency). **To verify in the plan.**

**Leaves.**
- One per host name, signed by the root, made on the first TLS handshake for that name (`SNICallback`).
- Subject alternative names: the name and, for a name with a sub-domain under it, `*.<name>` (`*.shop.localhost`; a bare `*.localhost` is invalid).
- Valid 365 days, renewed within 30 days of expiry.
- Cached in memory and on disk.

**Storage.**
- `userData/domains-ca.json` holds `{ root: { cert, key, sha1 }, leaves: { [name]: { cert, key, validUntil } } }`, written atomically, `0600` on macOS.
- Certificates and keys never leave this module except to the TLS server, and are never logged.
- Unreadable or invalid: regenerated, and the trust state goes back to `none`.

**Trust** (adapter helpers; `process.platform` stays in `src/main/platform/`):

| | Trust | Remove |
| --- | --- | --- |
| Windows | `certutil -user -addstore Root <file>` (user store, no admin; Windows shows its own confirmation) | `certutil -user -delstore Root <serial>` |
| macOS | `security add-trusted-cert -r trustRoot -k ~/Library/Keychains/login.keychain-db <file>` (asks for the password) | `security delete-certificate -Z <sha1> ~/Library/Keychains/login.keychain-db` |

- **The certificate file:** written to a temporary file for the command and deleted afterwards. The arguments are paths and hex strings only (`cmdInvocation` rules).
- **The trust state** is `none` (never asked or removed), `trusted`, or `untrusted` (declined or failed). It's kept in settings, so it doesn't need re-reading at startup. NestBox doesn't query the OS store, because the commands differ and they're slow.
- **Firefox:** current versions read the OS store by default on Windows and macOS (`security.enterprise_roots.enabled`). **To verify in the plan**; if it doesn't, Settings says how to turn it on.
- **Turning the feature off** stops the servers and keeps the CA. **"Remove NestBox's certificate authority"** removes it from the store and deletes the file.

## 4. Settings and IPC

**Settings** (`AppSettings.domains`, with a Zod default, so the store stays at v2):

```ts
domains: {
  enabled: boolean,                 // false
  httpPort: number,                 // 80  (1–65535, different from httpsPort)
  httpsPort: number,                // 443
  names: Record<string, string>,    // projectId → label override
  rewriteHost: Record<string, true>,// projectIds whose Host is rewritten
  trust: 'none' | 'trusted' | 'untrusted',
}
```

Removing a project drops its `names`/`rewriteHost` entries, in the same place that forgets its tool settings.

**Core channels.** Defined in `channels.ts`; the sender origin is checked and payloads validated, as for every channel:

| Channel | Input → output |
| --- | --- |
| `domains:status` | `{}` → `{ http: ServerState, https: ServerState, trust, routes: { name, projectId, script: string \| null, port: number \| null, source: 'main' \| 'script' \| 'detected' \| 'none' }[], clashes: string[] }`, where `ServerState` = `{ state: 'off' \| 'running' \| 'failed', port, code?, owner? }` |
| `domains:setEnabled` | `{ enabled }` → status (the first enable with `trust: 'none'` asks to trust, see UI) |
| `domains:setPorts` | `{ httpPort, httpsPort }` → status (VALIDATION when equal or out of range) |
| `domains:setName` | `{ projectId, label: string \| null }` → status (null clears the override) |
| `domains:setRewriteHost` | `{ projectId, rewrite }` → status |
| `domains:trustCa` / `domains:removeCa` | `{}` → `{ result: 'trusted' \| 'cancelled' \| 'failed' \| 'removed' }`. Main shows a native confirmation first; command output never reaches the renderer. |
| event `domains:changed` | no payload: the renderer refetches the status |

## 5. UI

- **Settings → Local domains** (a new section):
  - the on/off switch, the two ports, and each server's state; a failure shows the code and the port's owner;
  - the trust state with **Trust** / **Trust again**, and **Remove NestBox's certificate authority**;
  - the limits below, in two lines.
  
  The **first time** it's turned on, a NestBox dialog explains what the CA is, that it only covers `.localhost`, and that the OS will ask next. The answer leads to `domains:trustCa` or leaves it `none` with HTTPS untrusted.
- **Project header:** the project's URL next to its path (`https://shop.localhost`, `http://` when HTTPS isn't running, `:<port>` when not the default), opened through `app:openExternal`, with a copy button. Greyed out with a tooltip when the route is `none`. Only shown while the feature is on.
- **Project menu → "Local domain…"**: a small dialog to change the label (live validation, clash warning) and the "Rewrite the Host header" switch, with one line on when it's needed.
- **Ports page:** a "Domain" column with the name that routes to each port.
- **Command palette:** "Open \<name\>" for every route with a port.

## 6. Errors

| Situation | Behaviour |
| --- | --- |
| A port can't be bound | That server is `failed` (code, owner); the other runs; retried on a settings change. |
| The target refuses or resets before headers | 502 page. |
| No route, unknown name, foreign Host | The not-running page, the 404 page, 403. |
| CA file corrupt | Regenerated; `trust` set to `none`. |
| Trust command cancelled or failing | `trust: 'untrusted'`; HTTPS keeps serving the untrusted chain; no retry loop. |
| Quit | Both servers close within the quit controller's 5 s; open sockets (WebSockets included) are destroyed. |

**Logs:** names, ports, route sources, server states, error codes and trust results. Never paths, queries, headers, certificates or keys.

## 7. Limits (documented, not solved)

- **Server-to-server calls.** Outside browsers, `*.localhost` sub-domains don't resolve reliably (the Windows and macOS resolvers), and Node doesn't trust the CA without `NODE_EXTRA_CA_CERTS`. Backends keep calling `localhost:<port>`. Passing `NODE_EXTRA_CA_CERTS` to scripts NestBox starts is a possible follow-up.
- **Host checks.** Vite allows `*.localhost` by default. Next.js warns about cross-origin dev resources until `allowedDevOrigins` lists the name. The help text says so, and the rewrite switch is the fallback.
- **Ports 80/443** may be held by IIS, Docker Desktop or another proxy. The status names the owner; the user picks other ports.

## 8. Testing

- **Unit, pure:**
  - labels (slugs, scopes, length, clashes, overrides);
  - the router (main → script → detected → none, extra-server sub-domains, IPv6 targets, the proxy's own ports ignored);
  - forwarded headers (keep or rewrite Host, `X-Forwarded-*`, hop-by-hop dropped);
  - CA inputs (SANs, name constraints present and critical, renewal timing).
- **Unit, real sockets** (random ports, a test `node:http` target):
  - forwarding and streaming;
  - the 502, 404 and not-running pages and the 403;
  - a WebSocket echo through the upgrade;
  - the HTTP → HTTPS 308;
  - a TLS handshake through `SNICallback` with a leaf signed by a test CA, verified by Node's TLS against that CA;
  - a bind failure reported as `failed`.
- **Adapter:** the `certutil`/`security` command lines through fake command runners, like the existing adapter tests. The real trust store is never touched in tests.
- **Renderer:** the Settings section (states, first-run dialog, failures), the header link, the "Local domain…" dialog, the palette entries.
- **End to end:** domains on with ports 18080/18443 (CI can't count on 80/443), with the trust dialog stubbed in main like the other dialogs. A fixture dev server starts as a script, and the test fetches `http://shop.localhost:18080` through the proxy with an explicit `Host` header (no DNS needed), checking the 308 and the HTTPS response against the generated CA.

## Delivery

One PR, version **1.30.0**: CLAUDE.md gets a "Local domains" note (and `net/forward.ts` in the folder table), plus the README feature table and roadmap. Suggested order, for the plan:

1. `net/forward.ts`, extracted from the Inspector;
2. labels and router;
3. proxy over HTTP;
4. WebSockets;
5. CA and SNI;
6. adapter trust helpers;
7. settings and channels;
8. UI;
9. end to end.
