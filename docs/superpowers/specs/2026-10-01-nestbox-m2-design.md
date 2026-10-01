# NestBox M2 (Ports and env): Design Notes

Date: 2026-10-01
Status: Approved 2026-10-01
Source of truth: `docs/nestbox-spec.md`. These notes cover only the spec's gaps for M2, plus the M2 follow-ups listed in `docs/superpowers/HANDOFF.md`. They build on the M0 and M1 design notes and don't restate them.

## Scope

M2 delivers the roadmap's "Ports + env" row:

- A machine-wide list of listening TCP ports (Windows), with the NestBox project and script that own each port when known.
- Killing a port's owner: NestBox scripts are stopped like a user stop; other processes are killed after a confirm. There is no "free all".
- A watch list of common ports, shown on each project's Overview.
- "Kill the process on port N and restart" when a script's log shows `EADDRINUSE`.
- An env tool: a matrix of every `.env*` file (keys × files), flags for keys missing from `.env` and keys the example doesn't document, masked values revealed one at a time, copy without revealing, edit/add/remove that keep comments and order, and profiles.
- The env tool publishes `PORT`, `DATABASE_URL` and URL-like keys to shared context (main process only).
- The M2 follow-ups from HANDOFF: detection warnings and symlinks, `.envrc` no longer matched as an env file, the scripts tool's `scripts.processes` fact used for attribution, and tool calls waiting for detection instead of failing with NOT_FOUND.

**Not in M2:** macOS `listListeningPorts` (stub until the v2 macOS phase), UDP ports, editing env files that are not `.env*` (for example `config/*.env`), encrypted env files (dotenvx), and variable expansion (`${OTHER}` is shown and written verbatim).

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Where the port manager lives. Tools are per project, but the port list is machine-wide. | **Owner's choice: a global Ports page.** A "Ports" entry at the top of the sidebar, above the projects, opens it. Ports are a **core service** (`src/main/ports/`) with core channels `ports:list` and `ports:kill`, like `processes:*` in M1. Each project's Overview gets a Ports card with that project's ports and the watch list. |
| 2 | How the list stays current | **Owner's choice: poll every 3 s while visible.** The renderer polls `ports:list` (TanStack Query `refetchInterval`) only while the Ports page or a Ports card is mounted and the window is visible. Main caches a result for 1 s, so several cards share one scan. |
| 3 | Attribution: the listening PID is usually the server `node.exe`, three levels under the recorded `cmd.exe` root | **Walk the parent chain** from the listening PID to a live NestBox root PID (from `ProcessManager.list()`), at most 16 levels, using the M1 `listProcesses()` table. The table costs a PowerShell call, so it is fetched only when a listening PID appears that hasn't been attributed yet, and cached per PID until that PID stops listening. |
| 4 | Process name and command line | `tasklist /FO CSV /NH` gives image names for every PID in one fast call. The command line comes from one PowerShell call for the new PIDs only (same cache as #3). Command lines are shown in the UI, never logged or stored. |
| 5 | What "Kill" does | **A NestBox-owned port stops its script** (`ProcessManager.stop`, a user stop, never a crash), without a confirm. **Any other process** asks first ("Kill node.exe (PID 1234) listening on 3000? It wasn't started by NestBox."), then `killTree`. Killing PID 0/4 (System) or NestBox itself is refused with FORBIDDEN. |
| 6 | Watch list | `watchedPorts: number[]` in `AppSettings`, default `[3000, 5173, 5432, 6379, 8080]`, edited in the Settings dialog. A Zod default fills it for existing stores, so **no migration is needed** (the store stays at v2). |
| 7 | Detecting `EADDRINUSE` | **In the renderer, from the log text.** A pane scans its lines for `EADDRINUSE` with a port (`:::3000`, `0.0.0.0:3000`, `127.0.0.1:3000`, `port 3000`) after the script's last start. When found and the script is crashed or stopped, the pane shows a banner: "Port 3000 is in use by node.exe (PID 1234). [Kill and restart]". The action kills the owner (with the confirm from #5 when it isn't NestBox's), waits until the port is free (up to 5 s), then restarts the script. |
| 8 | Env editing scope | **Owner's choice: edit, add and remove**, in place, keeping comments, blank lines, key order, `export ` prefixes and each value's quote style. |
| 9 | Where values may travel | Values stay in main except for two explicit actions: **Reveal** (one value, one key, one file, returned to the renderer and shown until the row loses focus or 30 s pass) and **Edit** (the new value, typed by the user, sent to main). **Copy** writes the clipboard from main, so the value never reaches the renderer. The matrix carries presence, emptiness and a duplicate flag only. Values are never logged, stored, put in errors or sent in events. |
| 10 | Concurrent edits (an editor or a script changes the file) | Every file in the matrix has a `version` (`mtimeMs:size`). Writes send the version they were based on; a mismatch is a CONFLICT ("The file changed on disk. Reload and try again."). Writes are atomic (temp file + rename) and keep the file's line endings (CRLF or LF) and a final newline if it had one. |
| 11 | Profiles | **Owner's choice: `.env.<name>` files are the profiles**, except `.env.example`, `.env.backup` and `.env.*.example`. Switching copies the profile over `.env` and first saves the old `.env` as `.env.backup` (overwritten each switch). The active profile is the one whose contents equal `.env` byte for byte; otherwise none is active and the switch confirm says the current `.env` will be kept only as `.env.backup`. `Project.envProfiles` stays unused and is not migrated. |
| 12 | Which files count | The detected `envFiles` of the project or workspace package: names matching `^\.env(\..+)?$`, regular files only. Writes re-check the name, refuse symlinks (`lstat`) and paths outside the package folder, and refuse files over 1 MiB. |
| 13 | Missing and undocumented keys | Compared only when both `.env` and an example exist (`.env.example`, else `.env.sample` or `.env.template`). "Missing" = in the example, not in `.env`; "undocumented" = in `.env`, not in the example. A key with an empty value counts as present. |
| 14 | Keeping the matrix fresh | The env tool watches its package folder (`fs.watch`, non-recursive) for `.env*` changes while the project is open and emits `changed`; the panel refetches. Writes by NestBox also emit `changed`. |
| 15 | Shared context | After each read the env tool publishes `env.facts` = `{ port: number \| null, urls: string[] }` for its project, where `urls` are the **key names** of `DATABASE_URL` and keys ending in `_URL`/`_URI`. Values are published only for `PORT` (a number). The Ports card uses it: "PORT 3000 (from .env): free / used by …". |
| 16 | Tool calls during detection (HANDOFF) | `ProjectService.getDetected(id)` becomes async where tools need it: it awaits an in-flight detection of that project (with the existing timeout) before throwing NOT_FOUND. |

## Ports

`src/main/ports/port-service.ts`, with no Electron imports.

```ts
type PortRow = {
  port: number;
  address: string;          // '0.0.0.0', '::', '127.0.0.1', '::1', …
  pid: number;
  processName: string | null;  // 'node.exe'
  command: string | null;      // full command line, when it could be read
  owner: { projectId: string; script: string } | null;  // NestBox script that owns it
};
```

- **Windows `listListeningPorts`.** Runs `netstat -ano -p TCP` and `netstat -ano -p TCPv6`, keeps `LISTENING` rows, and joins `tasklist /FO CSV /NH` for names. Parsed by pure functions tested on captured fixtures (English output; the state column is matched by position, not by the word `LISTENING`, which is localised: a row is listening when its foreign address is `0.0.0.0:0` or `[::]:0`). A port bound on both IPv4 and IPv6 by the same PID is one row with both addresses.
- **`describeProcesses(pids)`** (new adapter method, Windows only): one PowerShell `Get-CimInstance Win32_Process -Filter "ProcessId=… OR …"` call returning `{ pid, commandLine }`. Capped at 64 PIDs per call.
- **`ports:list`** returns `{ rows: PortRow[], scannedAt }`, sorted by port. **`ports:kill { pid, port }`** applies decision #5. Both are core channels with Zod schemas.
- **Errors.** A failed scan returns the last good result with `stale: true`; the page shows "Couldn't refresh the port list" without clearing it.

## Env tool

`src/shared/tools/env/contract.ts`, `src/main/tools/env/`, `src/renderer/tools/env/`. `appliesTo`: always (so a project without env files can still show "No .env files").

- **Parser and writer** (`src/main/tools/env/dotenv.ts`, pure). A file is a list of lines: `blank`, `comment`, `entry` (`key`, raw value, quote `'`/`"`/`` ` ``/none, `export` prefix, inline comment), or `other` (kept verbatim). Double-quoted values may span lines and support `\n` escapes, like dotenv. A key that appears twice is flagged; the last one wins, as in dotenv. `setValue`, `addEntry` (appended after the last entry, before trailing blank lines) and `removeEntry` return the new text; untouched lines are byte-identical. A new value is written unquoted when it is safe, otherwise double-quoted with `\`, `"`, `$`-free escaping rules documented in the tests.
- **Contract.**
  - `matrix()` → `{ files: { name, version, entries: number, duplicates: string[] }[], keys: { key, cells: Record<file, 'set' | 'empty' | 'absent'> , missing: boolean, undocumented: boolean }[], example: string | null, profiles: { name, file, active: boolean }[] }`.
  - `reveal({ file, key })` → `{ value }`.
  - `copy({ file, key })` → `{}` (main writes the clipboard).
  - `setValue({ file, key, value, version })`, `addKey({ file, key, value, version })`, `removeKey({ file, key, version })` → `{ version }`.
  - `switchProfile({ file, envVersion })` → `{}`.
  - Event `changed` (no payload).
- **Validation.** Keys match `^[A-Za-z_][A-Za-z0-9_.-]*$`; values are at most 64 KiB; NUL is rejected.
- **Panel.** A table: keys as rows, files as columns, the example column first. Cells show `••••••` (set), `empty`, or nothing (absent). Hover actions per cell: Reveal, Copy, Edit; Add for an absent cell (prefilled empty; "Copy from example" when the example has a value). A row menu removes a key from one file. Flags show as badges on the key ("missing in .env", "not in example"), with a filter for flagged keys only. A Profiles bar above the table shows each profile, marks the active one and has "Switch to…".
- **Overview card.** File count, flagged key count and the active profile.

## Shell

- **Sidebar.** A "Ports" item above the project sections, with a count of listening ports owned by NestBox scripts. Selecting it shows the Ports page in `main`; selecting a project returns to it. The UI store gains `view: 'project' | 'ports'`.
- **Ports page.** A toolbar with a filter (port, process or project), an "Only NestBox" toggle and the last scan time. The table shows port, address, process, PID, owner (project · script, clickable to its Scripts tab), command (truncated, full on hover) and Kill.
- **Ports Overview card** (per project, a core card, not a tool): the project's own ports, then the watch list as chips (free / used by …), then `PORT` from `.env` when the env tool published one.
- **Status bar.** Unchanged.

## Detection follow-ups (HANDOFF)

- `readdir` failures produce a warning through `onWarning` instead of being swallowed.
- `.envrc` no longer counts as an env file (the pattern becomes `^\.env(\..+)?$`).
- Symlinks: env files that are symlinks are listed but marked read-only; workspace globs don't follow symlinked directories that resolve outside the root.

## Security notes

- Env values never reach logs, the store, error messages, IPC events or shared context (except `PORT` as a number). Tests assert that `matrix()` output and every logged field contain none of the fixture's secret values.
- `ports:kill` validates the PID against the current scan, so the renderer can only kill a PID that is listening right now.
- The clipboard is written by main (`clipboard.writeText`), wired in `index.ts` and injected into the env tool.

## Testing

- **Unit.** netstat/tasklist parsing (fixtures), attribution (parent walk, cache invalidation), port service (cache, stale results, kill rules), dotenv parser/writer (round-trips over a corpus of real-world files, edits, CRLF), env matrix (flags, profiles, duplicates), and the renderer table, banner and pages.
- **Integration (Windows CI).** A real `node` server on a random port appears in `listListeningPorts` with its PID; `describeProcesses` returns its command line.
- **End-to-end (Windows CI).** Start the fixture's `serve` script, see its port on the Ports page attributed to the project and script, stop it from there. Edit a value in the env tool and check the file on disk keeps its comments.
