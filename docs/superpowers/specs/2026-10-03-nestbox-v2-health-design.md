# NestBox v2 (Health checks): Design Notes

Date: 2026-10-03
Status: Approved 2026-10-03
Source of truth: `docs/nestbox-spec.md`, "v2 tools". The spec's entry: *Health checks: URLs per project pinged every N seconds; green or red dot on the overview; reads `PORT`, `API_URL`.* These notes build on the earlier design notes and don't restate them.

## Scope

The fourth v2 tool. It ships alone as **v1.5.0**, from the branch `v2-health`, in one PR.

**Owner's answers (2026-10-03):**
- **Checks:** the user adds URLs, with suggestions from `.env`. An env-key check stores only the key name; main reads the value, and the UI shows the key and host only.
- **When they run:** while one of the package's scripts is running, plus a Check now button.
- **Healthy:** a 2xx or 3xx answer within 5 s. Each check can expect a specific status instead.
- **Notifications:** a desktop notification when a check goes from green to red. It can be turned off.

**Not in this release:** response-body assertions, history graphs, checks that run without any script running, and the tray icon showing health.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Tool | Id `health`, name "Health", lucide `heart-pulse`. `appliesTo: () => true`. A factory like `scripts`: it needs `processes` (list and events), project lookup, tool settings outside handler calls, an emit, and a notifier. |
| 2 | Settings (root project, per package like Static's servers) | `toolSettings.health = { packages: { [relPath]: { checks: Check[], intervalSec } }, notify }`. A `Check` is `{ id, kind: 'url', url, expect? } \| { id, kind: 'env', key, path, expect? }`. `url` must be http(s) with no user or password, at most 2,000 characters. An env check has `path` (default `/`) appended to the env value's origin. `expect` is one status, 100–599. `intervalSec` is 5–600, default 30. `notify` defaults to true. At most 20 checks per package. Every field has a Zod default, so the store stays at v2. |
| 3 | Env-key checks | The key is a URL-like name (`/_(URL\|URI)$/`, the same rule the env tool publishes). Main reads it from the package's `.env` with `EnvFileAccess` and `parseEnv`, and keeps only the origin: protocol, host and port. The query and any credentials are dropped (`describeHttpUrl`). The UI shows `API_URL · api.local:4000` plus the path. A key that is missing, empty or not http(s) gives the state `config` with a reason, not red. `localhost:<PORT>` is suggested as a plain URL check, because PORT is already shared as a number. |
| 4 | Request | `node:http`/`https` `GET` with `Accept: */*`. Redirects are not followed (a 3xx counts as healthy unless `expect` says otherwise). Headers only: the response body is discarded once the headers arrive. The timeout is 5 s. TLS is verified, except for loopback hosts (`localhost`, `127.0.0.1`, `::1`), where dev servers and NestBox's own static server use self-signed certificates. The result is `{ state: 'ok' \| 'fail' \| 'config', status: number \| null, ms, reason: string \| null }`. The reason is a code such as `ECONNREFUSED`, `timeout`, `status 500` or `TLS`, never the URL. |
| 5 | Scheduling | A package is *live* while any running script `belongsTo` it (a root counts its workspace packages' scripts too). The tool listens to `processes.on('changed')`. When a package becomes live, its checks start: once 2 s after the change (servers take a moment), then every `intervalSec`. When nothing runs any more, the checks stop and their results turn grey (`idle`), but the last result stays visible. Check now runs a package's checks immediately, live or not. A settings change re-reads the checks. Timers are unref'd and cleared on dispose and on project removal. |
| 6 | Notifications | When `notify` is on, a check whose state goes from `ok` to `fail` (and only then, not on every failed ping) calls `notify({ projectId, title, body })`. The title is "<project> health check failed" and the body is the check's label and reason. Clicking it emits `app:navigate` `{ projectId, tab: 'health' }`. A check that fails from its first ping after a script starts doesn't notify: the server may still be starting. It notifies only once it has been green this session. The wiring lives in `main/index.ts` (Electron `Notification`), like the crash notice. |
| 7 | Events | `changed` (no payload) whenever results or live state change, at most 4 per second. The renderer refetches `status`. |
| 8 | Privacy | Plain URL checks are user-entered and are shown and stored as typed (without credentials, which the schema refuses). Env values never leave main and are never stored, only the key name. The logger records the package id, check id, state and code, never a URL. |
| 9 | Overview card | "Health": one row per check, with a dot (green ok, red fail, grey idle or not run yet, amber config), its label and the latency. The header says "Running" or "Idle (no scripts running)". "Open Health". With no checks, the card says "No checks" and offers the PORT suggestion as an Add button when there is one. |
| 10 | Panel | A list of checks: dot, label, last status and latency, last checked time, reason, and Remove. Add form: URL, or "From .env" with a select of URL-like keys plus a path. Then an optional expected status, the interval and the notify switch. Check now. Suggestions: `http://localhost:<PORT>/` and one per URL-like env key, each a one-click add. |
| 11 | Version | 1.5.0. |

## Contract (sketch)

```ts
const CheckInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: HttpUrl, expect: Status.optional() }),
  z.object({ kind: z.literal('env'), key: UrlKey, path: Path.default('/'), expect: Status.optional() }),
]);
const CheckView = z.object({
  id: z.string(),
  label: z.string(), // the URL as typed, or "API_URL · host:port/path"
  expect: Status.nullable(),
  result: z.object({ state: z.enum(['ok', 'fail', 'config', 'idle']), status: z.number().nullable(), ms: z.number().nullable(), reason: z.string().nullable(), at: z.number() }).nullable(),
});
// methods: status({}) → { live, intervalSec, notify, checks: CheckView[], suggestions: { port: number | null, envKeys: string[] } }
//          addCheck(CheckInput), removeCheck({ id }), setOptions({ intervalSec?, notify? }), checkNow({}). events: changed.
```

## Testing

- **Unit tests:**
  - **URLs:** `describeHttpUrl`, which drops credentials and the query string; the schema refuses URLs with a user or password.
  - **Requests:** `checkUrl` against real local servers: 200, 500, `expect` 401, a 3xx not followed, a refused connection, the timeout, and a body that isn't read.
  - **Live state:** a script starts and stops in a package or its workspace children.
  - **Scheduling:** the first check 2 s after a start, then the interval, with fake timers.
  - **Notifications:** sent only on ok→fail, not on a first failure, and not when notify is off.
  - **Env checks:** a missing key gives `config`.
  - **Logging:** nothing in the logs contains a URL.
- **Renderer:** the card's states; the panel's add flows (URL and env), remove, Check now, and suggestions.
- **End-to-end:** a fixture whose script starts a tiny HTTP server on `PORT`. The user adds the suggested `localhost:PORT` check and starts the script, and the card turns green. Stopping the script makes it grey.
