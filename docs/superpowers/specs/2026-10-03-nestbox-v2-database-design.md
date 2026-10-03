# NestBox v2 (Database panel): Design Notes

Date: 2026-10-03
Status: Draft, waiting for approval
Source of truth: `docs/nestbox-spec.md`, "v2 tools", which describes this tool as: *Database panel: checks `DATABASE_URL` is reachable; one-click `prisma migrate status`, `migrate dev`, `generate`, Prisma Studio.* These notes build on the earlier design notes and don't restate them.

## Scope

This is the second v2 tool. It ships alone as **v1.3.0**, from the branch `v2-database`, in one PR.

**Owner's answers (2026-10-03):**
- **Reachability:** both checks. A TCP connect runs on every refresh, and a "Test login" button runs a real `SELECT 1` through Prisma.
- **Which projects:** any package with a Prisma schema or a database URL. The Prisma buttons appear only when there is a schema.
- **Commands:** run in a mix of ways.
  - `migrate status` and `generate` run in the panel, with their output in a log.
  - `migrate dev` opens a terminal.
  - Studio runs in the background with an Open link.
- **Display:** the panel may show the provider, host, port and database name. It never shows the user, the password or the query parameters.

**Not in this release:**
- Drizzle, TypeORM and Knex commands. These projects still get the reachability check.
- `migrate reset` and `db push`, or any other destructive command started from the panel.
- Browsing data inside NestBox; Prisma Studio covers that.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Which projects | `appliesTo: (p) => p.prismaSchema !== null \|\| p.envFiles.length > 0`. Whether `DATABASE_URL` is set is only known by reading `.env`, so a package with env files but no URL key gets the tab with "No DATABASE_URL in .env". This is cheaper than reading every `.env` during detection, and the tab is harmless. |
| 2 | Which variable | With a schema: the `url = env("NAME")` of its `datasource` block (parsed with a small regex; `schema/` folders are scanned for the file that holds the datasource). Otherwise, and as a fallback: `DATABASE_URL`. A literal `url = "…"` in the schema is reported as "set in the schema" and is never read. |
| 3 | Where the value comes from | Prisma's own order: the package's `.env`, then `prisma/.env`, the first file that has the key. Reads go through the env tool's `EnvFileAccess` and `parseEnv`, so the active env profile counts (it is `.env`). Prisma 7's `prisma.config.ts` is not executed; when it exists and no `.env` has the key, the panel says so. **The value never leaves main:** it is parsed there, and only the parts in D4 travel. |
| 4 | What the renderer gets | `{ provider, host, port, database, source }`: for example `postgresql`, `localhost`, `5432`, `shop`, `.env`. The user, password and query string are dropped by `describeUrl`, a pure function with a test that feeds it URLs containing `s3cr3t` and checks the word never appears in its output. Unparseable URLs come back as `{ provider: 'unknown' }`. SQLite (`file:`) shows the file path relative to the schema folder. |
| 5 | Reachability (TCP) | `checkReachable` connects to `host:port` with a 3 s timeout (`net.connect`) and returns `reachable` / `refused` / `timeout` / `dns` (host not found). Default ports: postgresql 5432, mysql/mariadb 3306, sqlserver 1433, mongodb 27017, cockroachdb 26257. For `file:`, it checks that the file exists (relative to the schema folder, as Prisma does). For `mongodb+srv:`, `prisma://` and `prisma+postgres://` (Accelerate), it reports `not-checked` with the reason; SRV lookups and proxies are out of scope. No credentials are sent. |
| 6 | Test login | Runs `<pm-exec> prisma db execute --stdin --schema <schema>` with `SELECT 1` on stdin, timeout 20 s. Exit 0 means "Login works". Otherwise the first `P\d{4}` error code in the output is mapped to a NestBox message: P1000 wrong user or password, P1001 can't reach the server, P1003 the database doesn't exist, P1010 access denied, P1012 schema error, and anything else is "Failed (P####)". Prisma's own text, which can contain the user name, is not shown. Not offered for MongoDB, which `db execute` doesn't support. |
| 7 | Running Prisma | The command is the package manager's exec form: pnpm `pnpm exec prisma`, npm `npx --no-install prisma`, yarn `yarn prisma`, bun `bunx --no-install prisma`. `--no-install` means a project without Prisma installed never triggers a download. Commands run with `ctx.platform.spawnCommand` in the package folder with the shell env and `FORCE_COLOR=1`. The schema path is passed as `--schema` when it isn't the default. |
| 8 | In-panel commands | `migrate status` and `generate` run one at a time per package. A second click while one is running is refused, and the button shows a spinner. Output goes to a `BatchedLog` (ring buffer, 50 ms `logs` events, `getLogs`/`clearLogs`), shown with `LogView` like the Static tool's request log. Each run starts with a `$ prisma migrate status` line and ends with "exited with code N". A Stop button kills the tree. `migrate status` exit 1 (pending or drifted migrations) is shown as a warning, not an error. |
| 9 | migrate dev | Runs `ctx.platform.openTerminal(cwd, '<pm-exec> prisma migrate dev')`: it asks for a migration name and may ask to reset the database, and the user should answer those in a real terminal. The command is NestBox-built from plain words, so it passes both platforms' terminal checks. |
| 10 | Prisma Studio | Runs `prisma studio --port <p> --browser none` in the background, with the port from `firstFreePort(5555, '127.0.0.1')`. The panel shows "Running on http://localhost:5555" and an Open button (`app:openExternal`). It is stopped by Stop, on project removal, and by the tool's `dispose` (so quitting stops it). One Studio per package. Its output goes to the same log. A crash shows "Studio stopped (code N)". |
| 11 | Refresh | A `status` method reads the URL, checks reachability and reports the running commands. The renderer refetches on window `focus`, on the env tool's `changed` event for the same project (so editing `.env` or switching a profile updates the panel), and on the database tool's own `changed` event (a command started or stopped). The tool sets up no file watcher of its own. |
| 12 | Overview card | "Database". The first line is the provider and `host:port/db` with a dot: green reachable, red refused or timeout, grey not checked. If Studio is running, the card shows a link to it. The "Open Database" button opens the tab. Without a URL, the card says "No DATABASE_URL". |
| 13 | Privacy and logs | The URL value is never logged or stored. The logger records the tool, the method, the reachability result and exit codes only. The command log holds Prisma's output, which shows in the renderer only, like script logs; Prisma doesn't print passwords. |
| 14 | Version | 1.3.0, released with the same flow as v1.2.x. |

## Contract (sketch)

```ts
const DbTarget = z.object({
  provider: z.string(), // postgresql | mysql | sqlserver | mongodb | cockroachdb | sqlite | unknown
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  database: z.string().nullable(),
  source: z.enum(['.env', 'prisma/.env', 'schema']),
});
const DbStatus = z.object({
  prisma: z.object({ schema: z.string() }).nullable(),
  variable: z.string(), // DATABASE_URL or the schema's env("…") name
  url: z.discriminatedUnion('state', [
    z.object({ state: z.literal('set'), target: DbTarget }),
    z.object({ state: z.literal('missing'), configTs: z.boolean() }),
    z.object({ state: z.literal('literal') }), // url = "…" in the schema
  ]),
  reach: z.object({ result: z.enum(['reachable', 'refused', 'timeout', 'dns', 'missing-file', 'not-checked']), reason: z.string().nullable() }).nullable(),
  running: z.object({ command: z.enum(['migrate-status', 'generate']).nullable(), studio: z.object({ port: z.number() }).nullable() }),
});
// methods: status, testLogin → { ok, code: string | null, message }, run({ command }), stop({ what: 'command' | 'studio' }),
//          migrateDev, startStudio → { port }, getLogs, clearLogs. events: changed, logs.
```

## Testing

- **Unit:**
  - `describeUrl` with each provider, IPv6 hosts, `%`-encoded passwords and query strings, never echoing `s3cr3t`;
  - the datasource parser (an `env("X")` name, a literal URL, a multi-file `schema/` folder);
  - the `.env` → `prisma/.env` order;
  - the package-manager exec forms;
  - the P-code mapping;
  - the run lock;
  - Studio's port, Stop and dispose, with a fake platform.
- **Reachability:** against a real local `net.createServer` (reachable), a closed port (refused), an unresolvable `.invalid` host (dns), and SQLite file present and missing.
- **Renderer:** the card's states, the panel's buttons per state (Prisma or none, MongoDB without Test login), the log, Studio's Open link, and a refetch on the env tool's `changed`.
- **End-to-end:** a fixture with `prisma/schema.prisma` and a `.env` pointing at a TCP server the test starts. The card shows "postgresql · 127.0.0.1:<port>/shop" and Reachable. Stopping the server and refocusing shows Refused. No Prisma install is needed: the Prisma buttons are tested in unit tests with a fake platform.
