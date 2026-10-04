# NestBox v2 (Request inspector): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04. The owner answered the questions below and asked to continue without a separate approval stop; review it together with the PR.
Source of truth: `docs/nestbox-spec.md`, "v2 tools", which describes the tool as: *Records incoming requests and replays them to the API; later a `cloudflared` tunnel.* These notes build on the earlier design notes and don't restate them.

## Scope

The seventh and last of the planned v2 tools. It ships alone as **v1.8.0**, from the branch `v2-inspector`, in one PR.

**Owner's answers (2026-10-04):**
- It is a proxy in front of the API. NestBox listens on its own port, forwards every request to the API, and records both the request and the response.
- It keeps the full method, path, query, headers and bodies, in memory only, with secret headers masked until revealed.
- Replay resends a request as recorded. "Edit & send" lets you change it first.
- The target defaults to `http://localhost:<PORT>` from `.env` and can be edited, but only to local addresses.

**Not in this release:**
- The `cloudflared` tunnel (spec: "later").
- WebSockets.
- HTTPS on the inspector port.
- Saving or exporting recordings.
- Pausing.
- A catch-only mode without an API.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Tool | Id `inspector`, name "Inspector", lucide `radar`. `appliesTo: () => true`. |
| 2 | Settings (root project, per package) | `toolSettings.inspector.packages[relPath] = { port, target }`. `port` is `null` by default, meaning the first free port from 4020. `target` is `null` by default, meaning `http://localhost:<PORT>` with `PORT` read from the package's `.env` (only that number leaves the file). If `target` is set, it must be `http://` or `https://`, with the host `localhost`, `127.0.0.1` or `[::1]`, any port, an optional base path, and no user, password, query or fragment. No target and no PORT means Start is refused ("Set the API address"). |
| 3 | Proxy | One `node:http` server per package on `127.0.0.1`, started and stopped by the user.<br>• A non-local `Host` gets a 403, as in the mock API.<br>• Each request goes to `target` + path + query through `node:http`/`https`, which verifies TLS except for loopback hosts, as the health tool does.<br>• Hop-by-hop headers (`connection`, `keep-alive`, `proxy-*`, `te`, `trailer`, `transfer-encoding`, `upgrade`) are dropped. `host` becomes the target's. `x-forwarded-for`, `-host` and `-proto` are added.<br>• Bodies stream through in both directions. A request body over 10 MiB is cut off with a 413.<br>• An unreachable target answers 502 `{"error":"API unreachable","code":"ECONNREFUSED"}`. No response headers within 30 s answers 504.<br>• Redirects pass through to the client. WebSocket `upgrade` requests get a 501. |
| 4 | Recording | Up to 200 entries per package, in memory only. Each entry has:<br>• id, start time and duration;<br>• method and the path with its query;<br>• request headers, request body (up to 256 KiB, then "truncated");<br>• status, response headers, response body (same cap);<br>• an error code, and `replayOf` (the original entry's id, or null).<br>A compressed response (`gzip`, `deflate`, `br`) is decoded for display when it is fetched, not when it is recorded. The capture size is `min(256 KiB, bytes)` for each side, so the worst case is about 100 MiB per package. Clear empties the list. |
| 5 | Masking | Header values are masked (`••••••`) in everything sent to the renderer when the name is `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, or matches `/token\|secret\|password\|api[-_]?key\|session/i`. `reveal({ id, side, name })` returns one value, like the env tool's reveal. Bodies are shown as they are: inspecting them is the point of the tool. |
| 6 | Bodies in the UI | `get({ id })` returns the entry with bodies as text when they are UTF-8 and the content type is textual (`json`, `text/*`, `xml`, `javascript`, `x-www-form-urlencoded`); otherwise it returns "binary, N bytes". JSON is pretty-printed in the renderer. `list` returns summaries only: id, time, method, path, status, ms, sizes, `replayOf`, error. |
| 7 | Replay | `replay({ id })` sends the recorded request again, as captured, to the current target. It is refused when the body was truncated. `send({ method, path, headers, body, from })` sends an edited request. Header rows can say "keep the recorded value" for a masked header, so a secret never makes the trip to the renderer and back unless the user revealed and edited it. Both are recorded as new entries with `replayOf`, and both go straight to the target (not through the proxy port). They return the new entry's id. |
| 8 | Copy as curl | `copyCurl({ id })` builds a `curl` command (POSIX quoting, `--data-binary` for the body) and writes it to the clipboard from main, as the env tool's copy does. The command includes the real header values, because copying is the user's explicit act. It is refused for truncated or binary bodies. |
| 9 | Events | `changed` (no payload) when the server starts or stops or the settings change. `entries` (no payload, at most 4 per second) when entries are added or cleared. The renderer refetches `list` and keeps the selected entry's detail. |
| 10 | Privacy | Recordings are memory only: never stored, logged or exported. The logger records start and stop, the ports and the request count; never paths, headers or bodies. The target from `.env` is only `PORT`, a number. |
| 11 | Overview card | "Inspector": `localhost:4020 → localhost:3000` while running, or "Stopped"; the number of recorded requests and the last status; Start or Stop and "Open Inspector". |
| 12 | Panel | A header with the inspector URL (Open), the arrow, the target (an editable field, empty for "PORT from .env"), the port, and Start or Stop. The port-conflict help is the same as Static's and the mock API's. Below that, two panes:<br>• **List:** time, method, path, status (coloured), ms, and a replay badge, with a filter box and Clear.<br>• **Detail:** the summary line; Request and Response tabs, each with a headers table (masked values with a Reveal button) and the body (pretty JSON, or text, or "binary N bytes"); actions Replay, "Edit & send" and "Copy as curl".<br>"Edit & send" opens a dialog with method, path and query, header rows (masked rows show "recorded value" until changed) and the body. |
| 13 | Version | 1.8.0, released with the same flow as the earlier v2 releases. |

## Contract (sketch)

```ts
const Settings = { packages: record(relPath → { port: number | null, target: LocalUrl | null }) };
const Summary = z.object({ id, at, method, path, status: z.number().nullable(), ms: z.number().nullable(), reqBytes, resBytes, replayOf: z.string().nullable(), error: z.string().nullable() });
const Side = z.object({ headers: z.array(z.object({ name, value, masked: z.boolean() })), body: z.discriminatedUnion('kind', [{ kind: 'none' }, { kind: 'text', text, truncated }, { kind: 'binary', bytes }]) });
// methods: config, setOptions({ port?, target? }), status → { running, port, url, target, targetSource: 'setting' | 'env' | null, configChanged, count },
//          start, stop, nextFreePort, list → Summary[], get({ id }) → { summary, request: Side, response: Side | null },
//          reveal({ id, side, name }) → { value }, replay({ id }) → { id }, send({ from, method, path, headers: ({ name, value } | { name, keep: true })[], body }) → { id },
//          copyCurl({ id }), clear. events: changed, entries.
```

## Testing

- **Unit tests:**
  - **Target:** URL validation (local only, no credentials or query); resolution from settings or `.env` `PORT`.
  - **Proxy** (against real local servers):
    - forwarding of method, path, query, headers and bodies both ways; hop-by-hop headers dropped; `x-forwarded-*` added;
    - 502 when the API is down, 504 on a timeout, 413, 501 for `upgrade`, 403 for a non-local Host;
    - a streamed response passing through; recording caps and truncation; the ring of 200.
  - **Masking:** the names and patterns; `reveal`.
  - **Bodies:** text vs binary; decompressing gzip and br for display.
  - **Replay and send:** an exact resend, kept headers resolved in main, a truncated body refused, `replayOf`.
  - **curl:** quoting (quotes, newlines, `$`), and refusals.
  - **Tool:** start, stop, port conflict, `configChanged`, no target, dispose and project removal.
  - **Privacy:** results without masked values, and logs without paths.
- **Renderer tests:**
  - **Card:** stopped and running.
  - **Panel:** the list and its filter; the detail tabs with masked values and Reveal; Replay; Edit & send with kept headers; Copy as curl; Clear; the target field and Start/Stop.
- **End-to-end:** a fixture API (`node server.js` on `PORT` from `.env`) that echoes JSON. Start the script and the inspector, `fetch` through the inspector with an `Authorization` header, and check that the entry appears with the header masked and the response body shown. Then Replay and see a second entry marked as a replay.
