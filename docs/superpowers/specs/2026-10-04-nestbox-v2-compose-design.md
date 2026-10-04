# NestBox v2 (Docker Compose): Design Notes

Date: 2026-10-04
Status: Draft, for the owner's approval
Source of truth: `docs/nestbox-spec.md`, "v2 tools", which describes the tool as: *Services from `docker-compose.yml` with status, start, stop, logs into the log viewer.* These notes build on the earlier design notes and don't restate them.

## Scope

The fifth v2 tool. It ships alone as **v1.6.0**, from the branch `v2-compose`, in one PR.

**Owner's answers (2026-10-04):**
- Actions work per service and for the whole stack.
- Stop keeps the containers. A separate Down, after a confirmation, removes containers and networks. Volumes are never removed.
- Logs show one service at a time in the existing log viewer, only while the tab is open.
- Compose stays its own tab and card in this release. It doesn't join scripts or run groups.

**Not in this release:**
- Run groups or scripts starting the stack.
- Building images on its own (`up` builds when Compose decides to).
- Exec or a shell into a container.
- Choosing profiles or extra `-f` files.
- Volumes, images and anything outside the compose project. NestBox is not Docker Desktop.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Tool | Id `compose`, name "Compose", lucide `container`. It appears when detection found a compose file (`p.dockerCompose !== null`: `docker-compose.yml`, `docker-compose.yaml`, `compose.yml` or `compose.yaml` in the package folder). |
| 2 | Commands | Commands run as `docker compose -f <file> <command> …` with `cwd` set to the package folder, so Compose picks the same project name and `.env` as it would in the user's terminal. Short commands go through `ctx.platform.execCommand` and long ones through `spawnCommand`, so both pass through `cmdInvocation` on Windows. The arguments are only NestBox-built tokens, the detected file name, and service names. A service name must come from the current `config --services` list and match `^[A-Za-z0-9][A-Za-z0-9_.-]*$`; anything else is VALIDATION. |
| 3 | Services and status | `docker compose -f <file> config --services` gives the service list. `docker compose -f <file> ps --all --format json` gives the containers. Docker versions print either one JSON array or one object per line, and both are parsed. From each container only `Service`, `State`, `Health`, `ExitCode` and `Publishers` are kept. `Command`, `Labels` and the rest are dropped, because they can carry env values. A service without a container is shown as "not created". `status` makes both calls; main caches the result for 1 s. The renderer polls every 3 s, only while the Compose tab or card is mounted, and refetches after every action. |
| 4 | Docker missing or down | If `commandExists('docker')` is false, the state is `docker-missing` ("Docker isn't installed"). If `ps` fails because the daemon can't be reached (stderr matches `Cannot connect to the Docker daemon`, `error during connect`, `docker daemon is not running` or `pipe/dockerDesktopLinuxEngine`), the state is `daemon-down` ("Docker isn't running: start Docker Desktop"). If `config --services` fails, the state is `invalid` ("docker compose can't read <file>"). Docker's own message is not shown, because interpolated values can appear in it. Only the exit code is logged. |
| 5 | Actions | `up({ service? })` runs `up -d [--] [service]`; `stop({ service? })` runs `stop [service]`; `restart({ service })` runs `restart <service>`; `down()` runs `down` (never `-v` or `--rmi`), and the renderer asks for confirmation first. Actions run through `spawnCommand`, one at a time per package; a second action while one runs is CONFLICT. An action may pull images, so the timeout is 10 minutes, after which the process is killed. Its output streams into the package's **Actions** log (D6). The result is `{ ok, code }`, and the panel says "Up finished" or "Up failed (exit 1): see Actions". |
| 6 | Logs | Each package has a `BatchedLog` (ring buffer, 50 ms `logs` events, `getLogs`/`clearLogs`) for each log source: `actions`, plus one for the followed service. `follow({ service })` runs `docker compose -f <file> logs -f --no-color --tail 500 <service>` through `spawnCommand`, after first stopping any other follower of the package and clearing that service's buffer. `unfollow()` kills it. The renderer follows when a service is picked in the log selector and unfollows when the panel unmounts, so there is at most one follower per package. A follower that exits on its own (service removed, daemon stopped) adds a system line "■ log stream ended". Log lines are container output: they are shown like script output, and never logged by NestBox or stored. |
| 7 | Ports | Published ports come from `Publishers`: `PublishedPort → TargetPort/Protocol`, with `0` (not published) and duplicate IPv4/IPv6 entries dropped. The panel shows `5432→5432`. A TCP port whose target is 80, 443 or 3000–9999 gets an "Open" link to `http://localhost:<PublishedPort>` (`app:openExternal`). |
| 8 | Overview card | "Compose": "3 of 4 running" (healthy ones counted as running; unhealthy shown in amber), one dot per service (green running, amber starting or unhealthy, red exited with a non-zero code, grey stopped or not created), Up all / Stop all, and "Open Compose". The docker-missing, daemon-down and invalid states show their one-line message instead. |
| 9 | Panel | A header with the file name, Up all, Stop all and Down (with a confirmation dialog: "Remove the containers and networks of <project>? Volumes are kept."). Below that, one row per service: dot, name, state (with `exited (1)` and `healthy`/`unhealthy`), ports, and Start or Stop, Restart and Logs. Then the log viewer, with a selector for Actions or one service. While an action runs, its button spins and the other action buttons are disabled. |
| 10 | Lifecycle | Dispose and project removal kill the followers and any running action. Containers are left as they are: Docker runs them, not NestBox, so quitting NestBox never stops the stack (the panel says so under the header). |
| 11 | Privacy | Commands carry only NestBox tokens, the detected file name and validated service names. Results carry service names, states, exit codes and ports. Never kept: env, labels, commands, image digests, or Docker's error text. The logger records the package id, the command name (`up`, `stop`, …), the exit code and the duration. Container logs follow the script-log rules. |
| 12 | Windows | `spawnCommand` still lets cmd.exe find a program in the project folder (the open follow-up from v1.2.0). It applies to `docker` like it does to `claude`, and is fixed once for all of them in that follow-up, not here. |
| 13 | Version | 1.6.0, released with the same flow as the earlier v2 releases. |

## Contract (sketch)

```ts
const ServiceView = z.object({
  name: z.string(),
  state: z.enum(['running', 'starting', 'paused', 'restarting', 'exited', 'dead', 'created', 'not-created']),
  health: z.enum(['healthy', 'unhealthy', 'starting']).nullable(),
  exitCode: z.number().int().nullable(),
  ports: z.array(z.object({ published: z.number().int(), target: z.number().int(), protocol: z.string() })),
});
const ComposeStatus = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok'), file: z.string(), services: z.array(ServiceView), action: z.object({ name: z.string(), service: z.string().nullable() }).nullable(), following: z.string().nullable() }),
  z.object({ state: z.enum(['docker-missing', 'daemon-down', 'invalid']), file: z.string() }),
]);
// methods: status, up({ service? }), stop({ service? }), restart({ service }), down, follow({ service }), unfollow,
//          getLogs({ source, afterSeq? }), clearLogs({ source }). events: changed, logs({ source, lines }).
```

## Testing

- **Unit tests:**
  - **Parsing:** `ps --format json` as an array and as JSON lines, publishers (deduplication and 0), health, and exit codes. `config --services` output.
  - **Errors:** stderr classified as daemon-down; a missing command; an invalid file.
  - **Commands:** the exact argv of each action; service-name validation; CONFLICT for a second action; the 10-minute timeout kill; action output going into the Actions log.
  - **Logs:** following one service, then switching (the old follower killed, the buffer cleared); unfollow; an exit adding the system line; dispose killing everything.
  - **Privacy:** results without commands or labels; logs with no lines or error text.
- **Renderer tests:**
  - **Card:** counts, dots, and the three problem states.
  - **Panel:** rows, Start/Stop/Restart, Down's confirmation, the log selector following and unfollowing, and buttons disabled while an action runs.
- **End-to-end:** the CI runners can't be relied on for Docker (macOS runners have none, Windows runners can only run Windows containers). The spec puts a fake `docker` first on `PATH`: a small Node script with a `.cmd` shim on Windows that answers `config --services`, `ps`, `up`, `stop` and `logs` from a state file. It checks the card, Up all, a service stop, and the log stream in the panel. A real `docker compose` run is left to the owner's manual test.
