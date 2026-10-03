# NestBox v2.0 (macOS build) Implementation Plan

> Design: `docs/superpowers/specs/2026-10-03-nestbox-v2-macos-design.md` (decisions referenced as D1…D23).
> Branch: `v2-macos` from `main` (after PR #4 and v1.0.0). One PR, released as v1.1.0 once CI on `macos-latest` and `windows-latest` is green and the owner approves.
> Every task is TDD: the failing Vitest test next to the source first, then the code, then `pnpm typecheck && pnpm lint && pnpm test`. Conventional commits with the session trailer.

**Goal.** NestBox runs on macOS with the same features as on Windows, and ships as two DMGs next to the Windows installer.

**New dependencies.** None. `lsof`, `ps`, `open` and the login shell ship with macOS.

**Verification without a Mac.**
- Pure parsers and builders are tested everywhere.
- POSIX behaviour (process groups, signals, `ps`) is exercised on Linux too where it matches.
- Everything Mac-specific runs in `macos-latest` CI: integration tests, every end-to-end spec and the packaged smoke test.

---

## Part A: Adapter foundations

### Task 1: Process groups in the runner (D2)
**Files:** `adapter.ts`, `command-runner.ts`, `command-runner.test.ts`.
`PipedSpawnOpts.newProcessGroup?: boolean` sets `detached: true` (POSIX). Test on POSIX: the child's process group id equals its PID (`ps -o pgid=`); skipped on Windows.

### Task 2: Paths (D13)
**Files:** `paths.ts` (+ test). `normalizeDarwinPath`: resolve, no trailing slash, NFC, lower case. The darwin `samePath` uses it; replace the old case-sensitive stub test.

### Task 3: Login-shell environment (D5)
**Files:** `posix-shell.ts` (+ test).
- `parseMarkedEnv(stdout, marker)`: NUL-separated pairs between two markers. Tests cover banners before and after, `=` inside values, empty values and a missing end marker (→ null).
- `createShellEnv({ runner, shell, fallback, logger })`: runs `<shell> -ilc "printf <m>; env -0; printf <m>"` with stdin ignored and a 10 s timeout, caches the result and exposes `clear()`.
- A logger test proves no value is ever logged.

### Task 4: Command lookup (D12)
**Files:** `posix-shell.ts`. `findOnPath(command, PATH, access)`: absolute paths are checked directly; otherwise every `PATH` entry with `X_OK`. Tests use a fake `access`.

## Part B: The darwin adapter

### Task 5: Ports through lsof (D6)
**Files:** `darwin-ports.ts` (+ test, fixtures in `__fixtures__/lsof-*.txt`). `parseLsof(-F pcn output)` → `PortEntry[]`. Covers IPv4 and IPv6 (`[::1]:3000`, `*:5173`), several sockets per PID merged by port, and a PID with no name. `listListeningPorts` runs `lsof` with a 4 MiB cap. Exit 1 with empty output means no listeners, not an error.

### Task 6: ps parsers (D7)
**Files:** `darwin-ps.ts` (+ test). `parseEtime` handles `05`, `01:05`, `02:01:05` and `3-02:01:05`. `parsePsList` → `ProcessInfo[]`; `parsePsCommands` → `Map`. The adapter runs both with `LC_ALL=C`. `describeProcesses` keeps the 64-PID limit and integer-only arguments.

### Task 7: killTree (D3)
**Files:** `darwin.ts`, `posix-kill.ts` (+ test). `killTree(pid, { kill, list, sleep })`:
1. descendants from one `ps` call;
2. `SIGTERM` to `-pid` and to descendants outside the group;
3. poll `kill(pid, 0)` every 100 ms for up to 3 s;
4. `SIGKILL` the same set.

Tests use a fake process table. `ESRCH` counts as done; `EPERM` on a foreign PID is FORBIDDEN.

### Task 8: Spawning (D4)
**Files:** `darwin.ts`. `spawnScript`, `spawnCommand` and `execCommand` spawn directly with `newProcessGroup` (not for `execCommand`) and the resolved env. Tests use the runner spy: no shell, args intact.

### Task 9: Editor and terminals (D9–D11)
**Files:**
- `darwin-terminal.ts` (+ test): `chooseTerminal(setting, installed)`, `commandFile(cwd, command)` (quoting tests: spaces, `'`, `$`, unicode), and the `open` argument lists for Terminal, iTerm and Ghostty;
- `darwin.ts`: `openTerminal`, `openInEditor` with the `code` fallback.

Temp files are created with mode 0700 and removed by a timer. Installed apps are detected with `mdfind kMDItemCFBundleIdentifier == "com.googlecode.iterm2"` (and Ghostty), falling back to checking `/Applications`.

### Task 10: Ports kill rules (D8)
**Files:** `port-service.ts` (+ test). PID 1 joins the protected set.

## Part C: Settings and app shell

### Task 11: Terminal setting (D9)
**Files:**
- `src/shared/settings.ts` and `types.ts`: `TERMINAL_APPS`, and the patch schema;
- `SettingsDialog.tsx` (+ test): options per platform from `getInfo`;
- `win32.ts` (+ test): choosing cmd skips `wt`;
- `PlatformDeps.getTerminalApp()`.

The store stays at v2: the stored value is still a string.

### Task 12: Application menu (D14, D15)
**Files:**
- `src/main/app-menu.ts` (+ test): a pure template from `{ isDev, actions: { settings, quit, about } }`;
- `index.ts`: `Menu.setApplicationMenu` on macOS, `null` on Windows; `activate` shows the window.

### Task 13: Title bar, hints and menu-bar icon (D16–D18)
**Files:**
- `TitleBar.tsx` (+ test): left padding on darwin;
- `src/renderer/lib/platform.ts`: `usePlatform()` and `modKey`;
- `PromptBox.tsx` and the palette: `⌘` on darwin;
- `tray-controller.ts`: a `clickShowsWindow` option (false on macOS);
- the `trayIconTheme` default resolved per platform when unset.

## Part D: Shipping

### Task 14: Packaging (D20)
**Files:** `electron-builder.yml`. Verify locally with `electron-builder --mac --dir` where possible. On Linux, building macOS targets fails, so this is verified in CI.

### Task 15: CI matrix (D22)
**Files:**
- `ci.yml`: the `e2e` and `package` jobs run on both OSes;
- `e2e/packaged.spec.ts`: the executable path from `NESTBOX_PACKAGED_EXE` (the job finds `NestBox.app/Contents/MacOS/NestBox` on macOS);
- `darwin.integration.test.ts`.

Fix whatever the existing end-to-end specs assume about Windows (paths, `.cmd`, kill timing).

### Task 16: Release workflow (D21)
**Files:** `release.yml`: a matrix over Windows and macOS, a per-OS build command and file glob, the same `tag_name`, and the version check in both.

### Task 17: README and docs (D23)
**Files:**
- `README.md`: macOS install (preview);
- `CLAUDE.md`: the darwin adapter, process groups, the shell env, terminals and gotchas;
- `HANDOFF.md`;
- `package.json`: version `1.1.0`, at the end.

### Task 18: Verification and review
- full checks;
- every CI job green on both OSes;
- code review, with fixes;
- a PR checklist for the owner. There's no Mac, so the checklist covers reading the CI artifacts and a Windows regression pass.
