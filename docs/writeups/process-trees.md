# Stopping a dev server for real: process trees on Windows and macOS

NestBox's first job is "Start" and "Stop" next to `pnpm dev`. That sounds like `spawn` and `child.kill()`. It isn't, and getting it right on two operating systems took more design than any tool in the app. This is how it works and why.

## The problem

`pnpm dev` is not one process. On Windows it is `cmd.exe` → `pnpm.cmd` → `node pnpm.cjs` → `node vite.js` → maybe an esbuild service. On macOS it is `pnpm` → `sh -c vite` → `node` → `esbuild`. The process NestBox spawned is the top of that tree, and the one holding port 5173 is somewhere at the bottom.

`child.kill()` signals only the top. On Windows that is `TerminateProcess` on `cmd.exe`: the Node processes under it carry on, now parentless, still holding the port. On macOS `SIGTERM` to `pnpm` may or may not be forwarded, depending on the package manager and version. Either way, the next "Start" fails with `EADDRINUSE`, and the user has no idea which process to kill.

Four things have to be true:

1. **Stop means the whole tree**, on both systems.
2. **A stop is not a crash.** The log, the tray and auto-restart must know the difference.
3. **NestBox crashing must not leak servers.** After a hard kill of NestBox itself, the next start should find what it left behind and offer to stop it.
4. **Never kill the wrong process.** PIDs get reused, and "kill this PID" a day later can hit an unrelated program.

## Windows: cmd.exe and taskkill

Current Node refuses to spawn `.cmd` files directly (the CVE-2024-27980 fix), and npm, pnpm and yarn are all `.cmd` shims. So scripts start as `cmd.exe /d /s /c "<pm> run <script>"`, built by `cmdInvocation` (`src/main/platform/win32-escape.ts`). It refuses `"`, CR, LF and NUL outright, because a `.cmd` shim re-parses `%*` and quotes can't be escaped safely there. Only paths and NestBox-built tokens ever go through it.

Stopping is `taskkill /PID <root> /T /F` (`win32.ts`). `/T` walks the parent links Windows keeps and terminates the whole tree. `/F` is needed because console programs without a window don't get `WM_CLOSE`. Exit code 128 ("no such process") counts as success, because the process being gone is what we wanted.

The catch is that `taskkill /F` makes the root exit with code 1. To `ProcessManager` that looks exactly like a script that failed. So the manager sets `stopRequested` before it calls `killTree`, and `onClose` checks that flag before it looks at the exit code:

```ts
if (entry.stopRequested) {
  entry.state = 'stopped';        // the user asked: never a crash
} else if (code === 0) {
  entry.state = 'exited';
} else {
  entry.state = 'crashed';        // counts towards auto-restart and notifications
}
```

Every close is also tagged with a run number. A late `close` from the previous run of a restarted script is dropped instead of marking the new one as crashed.

## macOS: process groups, then descendants

POSIX has a better tool than parent links: process groups. Scripts are spawned without a shell, as the leader of a new group (`detached: true` in Node terms; `newProcessGroup` in the adapter). Everything they start joins that group unless it opts out, and `kill(-pgid, SIGTERM)` signals all of it at once.

"Unless it opts out" matters. Some dev servers daemonise or call `setsid`, and those processes have left the group. So `killProcessTree` (`posix-kill.ts`) does more:

1. Lists processes first (`ps -axo pid=,ppid=,pgid=,etime=`) and collects the root's descendants by parent link.
2. Sends `SIGTERM` to the group, then to every descendant that is still alive. (When the root leads no group, for example a process from another tool on the Ports page, it signals the PID itself.)
3. Waits up to 3 s, polling every 100 ms, so servers get to close sockets and flush.
4. Sends `SIGKILL` to whatever is left.

`EPERM` becomes a `FORBIDDEN` error ("belongs to another user") instead of a silent failure. The function also refuses PIDs 0 and 1, because `kill(-1)` signals everything the user owns and `kill(0)` signals NestBox's own group.

The same idea runs through the other spawns. `spawnCommand` (the Claude quick prompt, docker compose, cloudflared) also creates a group, so disposing a tool stops what it started. It is never used on Windows, where `detached` opens a console window instead.

## Surviving NestBox's own crash: the PID ledger

If NestBox is killed (Task Manager, a crash, a power cut), nothing runs `killTree`. The servers keep their ports, and the next NestBox has no memory of them.

So every root PID goes into `userData/processes.json` when it is spawned, together with its **spawn time** and the script it belongs to (`pid-ledger.ts`). No command lines and no environment are stored. Writes are atomic (a temp file and a rename) and never throw. A clean exit removes the entry; a quit through the quit controller stops everything first. Whatever is still in the file at the next start belongs to a session that did not end cleanly.

At startup the orphan check (`lifecycle/orphans.ts`) lists all processes once. That is one PowerShell `Get-CimInstance Win32_Process` call on Windows, and `ps` on macOS. It then matches them against the ledger:

- **The PID alone proves nothing.** Windows reuses PIDs quickly. An entry counts only if the live process with that PID was created within 3 s of the recorded spawn time. Entries without a start time are never offered.
- **The root may be gone while its children aren't.** On Windows, killing NestBox can take `cmd.exe` with it while `node` keeps running. The children still name the dead PID as their parent (Windows doesn't re-parent), so the check offers those children, provided they started after the root. On macOS, launchd adopts them, but they are still in the group whose id is the old root PID, and a group id can't be reused while any member lives.
- **If the root PID now belongs to someone else** (its start time doesn't match), its children are that process's children, and they are left alone.

The user sees "2 scripts from the last session are still running", with the project, script and PIDs, and chooses whether to stop them. The ledger entries are dropped only after an answer (or kept when the process list can't be read), so a second crash during the prompt loses nothing.

macOS start times come from `ps etime` (elapsed time, 1 s precision), which is one more reason the tolerance is 3 s and not 100 ms.

## Testing it without two machines

All of this sits behind the `PlatformAdapter` interface. `src/main/platform/` is the only place allowed to read `process.platform` (a lint rule enforces it), so most of the logic is tested on any OS:

- `killProcessTree` takes `kill`, `list` and `sleep` as dependencies. Its unit tests script ESRCH, EPERM, escaped descendants and a slow exit without touching real processes.
- `ProcessManager` runs against a fake child (`fake-child.ts`) that can exit with any code at any moment, which covers "user stop with exit 1", a late close from the previous run, and auto-restart backoff.
- `findOrphans` is a pure function over ledger entries and a process list.
- Integration tests spawn real trees: `win32.integration.test.ts` on Windows CI, `darwin.integration.test.ts` on macOS and Linux. They check that a grandchild is really gone after `killTree`.

One surprise from the Linux runs: in some containers PID 1 never reaps orphans, so a killed grandchild stays a zombie and `kill(pid, 0)` still says it exists. The integration tests read `ps -o stat=` and accept `Z`. On a real Mac, launchd reaps at once.

## What it buys

Stop is instant and complete, a crash is never confused with a stop, and NestBox cleans up after itself even when it didn't get the chance to. Every other feature depends on this: the Ports page attributes a port to a script by walking the same parent chain up to a ledger root, and tools like Compose, Studio and the tunnel stop their own processes through the same adapter.
