# NestBox v2 (Mock API): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04
Source of truth: `docs/nestbox-spec.md`, "v2 tools", which describes the tool as: *UI-defined routes returning JSON with latency and error toggles; saved per project.* These notes build on the earlier design notes and don't restate them.

## Scope

The sixth v2 tool. It ships alone as **v1.7.0**, from the branch `v2-mock-api`, in one PR.

**Owner's answers (2026-10-04):**
- Routes are saved in NestBox's settings, per package. Nothing is written into the project folder.
- A route is a method and a path with `:params` and a trailing `*`, returning a status, headers and a JSON or text body. The body can use `{{params.x}}` and `{{query.x}}`. There is no scripting.
- Each route has its own delay and a fail switch. On top of those, a server-wide extra delay and a "fail everything" switch.
- An unmatched request gets a 404. Every request is shown in a request log in the panel.

**Not in this release:**
- Proxying unmatched requests to a real API.
- Response sequences.
- OpenAPI import.
- Sharing on the LAN or HTTPS.
- Recording real traffic (that is the request inspector's job).

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Tool | Id `mock`, name "Mock API", lucide `braces`. `appliesTo: () => true`. |
| 2 | Settings (root project, per package like Static's servers) | `toolSettings.mock.packages[relPath] = { port, routes, delayMs, failAll }`. `port` is `null` by default, meaning the first free port from 4010 (Prism's default, clear of 3000, 4173 and 5173). `delayMs` is 0–10,000 and is added to every route's own delay. `failAll` is `{ on, status }`, default `{ false, 500 }`. Every field has a Zod default, so the store stays at v2. At most 100 routes per package. |
| 3 | Route | `{ id, enabled, method, path, status, contentType, headers, body, delayMs, fail }`:<br>• `method`: GET, POST, PUT, PATCH, DELETE or ANY.<br>• `path`: starts with `/`, at most 500 characters, built from segments; `:name` matches one segment and a final `*` matches the rest.<br>• `status`: 100–599.<br>• `contentType`: `json` (`application/json; charset=utf-8`) or `text` (`text/plain; charset=utf-8`).<br>• `headers`: at most 20; the name is an HTTP token, the value has no CR, LF or NUL, and `content-length`, `transfer-encoding` and `connection` are refused.<br>• `body`: at most 256 KiB.<br>• `delayMs`: 0–10,000.<br>• `fail`: `{ on, status }`.<br>A JSON body must parse once every placeholder is replaced by `0`. A text body is free. |
| 4 | Matching | A request's path, without the query, is matched against the enabled routes in list order; the first match wins. A trailing slash is ignored. HEAD matches GET routes and is sent without a body. `ANY` matches every method. A segment match is case-sensitive, and percent-encoding is decoded per segment. |
| 5 | Placeholders | `{{params.name}}` and `{{query.name}}` are replaced in the body. Missing values become an empty string. In a JSON body the value is escaped as the inside of a JSON string, so a placeholder belongs inside quotes (`"id": "{{params.id}}"`). There are no expressions or other variables. |
| 6 | Server | One `node:http` server per package, on `127.0.0.1` only, started and stopped by the user (never automatically). A request whose `Host` isn't `localhost`, `127.0.0.1` or `[::1]` (with any port) gets a 403, against DNS rebinding. CORS is always on: `Access-Control-Allow-Origin` echoes the request's origin, `Vary: Origin` is set, and credentials are allowed. An `OPTIONS` preflight gets a 204 with the requested method and headers allowed. A request body is read and dropped, up to 1 MiB; past that the server answers 413. Routes and toggles take effect on the next request. Changing the port while running shows "restart to apply", as Static does. |
| 7 | Responses | The delay is the global `delayMs` plus the route's own, waited with a timer that a closed request clears. A failing route (its own switch, or `failAll`) answers its fail status with `{"error":"Mocked failure"}`. An unmatched request gets a 404 with `{"error":"No mock route","method":"GET","path":"/x"}`, the path without the query. Every response carries `X-NestBox-Mock: <route id or none>` and `Cache-Control: no-store`. |
| 8 | Request log | A `BatchedLog` per package: `GET /users/42 → 200 · 12 ms · GET /users/:id`, or `→ 404 · no route`. The query string is dropped, and request headers and bodies are never shown. The log is in memory only. The logger records start and stop, the port and the request count, never paths. |
| 9 | Lifecycle | The server stops on dispose (quit) and when its project is removed. It doesn't start with the app. Start fails with CONFLICT and "Port 4010 is in use" when a configured port is taken, and offers "Use the next free port", as Static does. |
| 10 | Overview card | "Mock API": the URL while running (`http://localhost:4010`), or "Stopped". It shows "N routes", "fail all" in red when that is on, Start or Stop, and "Open Mock API". |
| 11 | Panel | A header with the URL (Copy, Open), the port, and Start or Stop. A toggles row with an extra delay (ms) and a "Fail every request with <status>" switch. The routes table: enabled switch, method badge, path, status, delay, fail switch, Edit, Duplicate, Delete, and reordering with up/down buttons (first match wins). Add route opens the editor, a dialog with method, path, status, content type, headers as rows, the body (a monospace textarea with JSON validation and a Format button for JSON), delay and fail status. Below everything, the request log in the log viewer. |
| 12 | Privacy | Routes are the user's own data, stored in NestBox settings like Static's config. Requests from the user's own app can carry tokens, so request headers and bodies are never kept, shown or logged, and the query string is dropped from the log. |
| 13 | Version | 1.7.0, released with the same flow as the earlier v2 releases. |

## Contract (sketch)

```ts
const Route = z.object({ id, enabled, method: z.enum([...METHODS, 'ANY']), path, status, contentType: z.enum(['json', 'text']), headers: z.array(z.object({ name, value })).max(20), body: z.string().max(256 * 1024), delayMs, fail: z.object({ on: z.boolean(), status }) });
const PackageMock = z.object({ port: z.number().int().min(1).max(65535).nullable(), routes: z.array(Route).max(100), delayMs, failAll: z.object({ on, status }) });
const MockStatus = z.object({ running: z.boolean(), port: z.number().nullable(), url: z.string().nullable(), configChanged: z.boolean(), requests: z.number() });
// methods: config → PackageMock, saveRoute({ route }) (add or replace by id), deleteRoute({ id }), moveRoute({ id, to }),
//          setOptions({ port?, delayMs?, failAll? }), status, start, stop, nextFreePort, getLogs, clearLogs.
// events: changed, logs.
```

## Testing

- **Unit tests:**
  - **Paths:** compiling and matching `:params`, `*`, trailing slashes and percent-encoding; first match wins; HEAD and ANY.
  - **Placeholders:** substitution and JSON escaping, missing values, and JSON validation with placeholders.
  - **Schema:** header rules, size caps, the 100-route cap.
  - **Handler** (against a real local server):
    - a matched route with its status, headers and body; 404 for unmatched;
    - CORS and preflight; the Host check giving 403; the 413 body cap;
    - per-route and global delay (fake timers); fail and fail-all;
    - the `X-NestBox-Mock` header; log lines without the query.
  - **Tool:**
    - save, replace, delete and move routes; options;
    - start, stop, a port in use giving CONFLICT, and `configChanged`;
    - edits taking effect without a restart;
    - dispose and project removal stopping the server.
- **Renderer tests:**
  - **Card:** stopped and running.
  - **Panel:** the route table and its actions (enable, fail, move, duplicate, delete); the editor's validation (bad path, bad JSON, header rules) and Format; the global toggles; Start and Stop.
- **End-to-end:** add `GET /users/:id` returning `{"id":"{{params.id}}"}`, start the server, `fetch` `/users/42` from the test runner (`{"id":"42"}`) and see the log line; switch Fail on and get a 500; an unmatched path gets a 404.
