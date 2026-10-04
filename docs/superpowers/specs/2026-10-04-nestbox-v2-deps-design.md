# NestBox v2 (Dependency health): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04. Scope comes from the owner's write-up ("Next in v2"). The owner chose the cross-project page, the schedule, the saved cache and read-only actions. The command details below were checked on npm 10.9, pnpm 10.28, Yarn 1.22, Yarn 4.18 and Bun 1.3.14.
Source of truth: `docs/nestbox-spec.md`, "Next in v2: Node version check and dependency health".

## Scope

Outdated and vulnerable dependencies per package, for every package manager NestBox detects. There is a tab and a card per project, and a sidebar page across all projects. This is the one tool allowed to reach the network, and only through the package manager, when the user clicks Check or the schedule they turned on runs. Ships as **v1.12.0** from `v2-deps`, stacked on `v2-node-check`.

**Not in this release:**
- Updating anything: NestBox never writes `package.json` or a lockfile.
- Fix suggestions beyond the update command.
- Licence checks.
- Transitive outdated packages.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Adapters | One per manager, run in the package folder through `spawnCommand` with the login-shell env plus `NO_COLOR=1`. A command's stdout is the result whatever the exit code (npm and pnpm exit 1 on findings, `yarn audit` exits with a severity bitmask); only output that doesn't parse is a failure. **npm:** `outdated --json`, `audit --json`. **pnpm:** `outdated --format json`, `audit --json`. **Yarn 1:** `outdated --json` and `audit --json`, both JSON lines. **Yarn 2+** (`yarn --version` major ≥ 2): `npm audit --json` (JSON lines); it has no `outdated`, so it uses the fallback. **Bun:** `audit --json`; `outdated` prints only a table, so it uses the fallback. |
| 2 | Fallback | The direct dependencies from `package.json`. Installed versions come from `node_modules/<name>/package.json`; with Yarn's Plug'n'Play there is none, so it shows "unknown". Registry data comes through the manager, so its registry and `.npmrc` auth apply: `yarn npm info <name> --fields versions,dist-tags --json`, or `bun pm view <name> versions --json` plus `dist-tags --json`. Wanted is the highest version matching the range, latest is the `latest` tag. Four at a time, at most 200 dependencies. Specs that aren't semver ranges (`workspace:`, `file:`, git, URLs) are skipped. Names must match the npm name pattern before they reach a command line. |
| 3 | Shape | Each package's result holds every direct dependency (name, type, range, installed version, from `node_modules`) merged with the adapter's wanted and latest, plus vulnerable transitive packages as their own rows. Each row has `outdated`, `major` (latest's major is above the installed one) and its advisories (id, title, severity, an https URL or null, the vulnerable range). The package's severity is its highest advisory's. Errors are per step (`outdated` or `audit`): `failed` or `timeout`, never the tool's own text. At most 1,000 rows per package. |
| 4 | Workspaces | Check on a root checks the root and each workspace package in turn. Check on a package checks that package. The root's card and tab add up all of them; the tab has a package picker. |
| 5 | When | Only Check, or the schedule. Opening the tab or the card never starts a check. One check per root project at a time (CONFLICT). Each command times out after 2 minutes. |
| 6 | Schedule | The app setting `depsSchedule: 'off' \| 'daily' \| 'weekly'` (default off, a Zod default, so the store version stays). When it is on, main looks once an hour for root projects whose last check is older than the interval and checks them one at a time, in the background, while NestBox runs. |
| 7 | Cache | `userData/deps-cache.json`, `{ version: 1, results: { [projectId]: PackageResult } }`, written atomically after every check and read at startup. It holds package names, versions, ranges and advisory data only: never `package.json` contents beyond dependency names and ranges, and never command output. Removing a project removes its entries; a malformed file is ignored. |
| 8 | Actions | Read-only. "Copy update command" (written to the clipboard from main) per row: npm `npm install <name>@latest` (`-D` for dev), pnpm `pnpm add <name>@latest` (`-D`), Yarn 1 `yarn upgrade <name>@latest`, Yarn 2+ `yarn up <name>@latest`, Bun `bun add <name>@latest` (`-d`). Advisory links open through `app:openExternal`. |
| 9 | Cross-project page | A "Dependencies" entry under Ports in the sidebar (`view: 'deps'`). From the cache: projects with high or critical advisories first, then a search by package name that lists every project and package using it, with range and installed version. It also shows when each project was last checked, and "Check all now" (the same run as the schedule). New core channels: `deps:overview` and `deps:checkAll`; the page polls the overview every 3 s while a run is going. |
| 10 | Privacy | Logs carry ids, steps, exit codes, counts and times; never output, URLs or package names. The registry and its credentials stay with the package manager. |
| 11 | Version | 1.12.0. |

## Testing

- **Unit tests:**
  - **Parsers:** each adapter, fed real outputs captured from the versions above and trimmed, as fixtures.
  - **Exit codes:** findings with a non-zero exit are results; unparseable output is a failure.
  - **Fallback:** installed versions, wanted and latest, skipped specs, name validation, concurrency cap.
  - **Merge:** rows, major and severity.
  - **Tool:** check, workspace roll-up, CONFLICT, cache write and read, copy command.
  - **Scheduler:** due projects, one at a time, off.
- **Renderer tests:** card, tab (filters, package picker, advisories, copy) and the Dependencies page (search, advisories first, Check all).
- **End-to-end:** a fake `npm` on PATH (`e2e/fixtures/fake-npm`) answers `outdated` and `audit` with fixture JSON. Check shows the outdated and vulnerable rows, the card counts them, and the sidebar page finds the package.
