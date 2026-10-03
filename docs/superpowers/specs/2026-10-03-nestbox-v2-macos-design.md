# NestBox v2.0 (macOS build): Design Notes

Date: 2026-10-03
Status: Draft, awaiting the owner's approval
Source of truth: `docs/nestbox-spec.md` ("v2 starts with the macOS build"). These notes cover only what macOS needs. They build on the M0–M3 design notes and don't restate them.

## Scope

v2 starts with the macOS build:

- **A real `darwin` platform adapter** in place of the stub: ports, processes, process-tree kills, the login-shell environment, terminals, the editor, command lookup and path comparison.
- **macOS app behaviour**: an application menu, the Dock, `⌘Q` through the quit controller, traffic-light spacing, the menu-bar (tray) icon and `⌘` in shortcut hints.
- **A terminal setting** on both platforms: auto-detect, or a chosen app.
- **Shipping**: two unsigned DMGs (arm64, x64) on the same draft release as the Windows installer, end-to-end and packaged smoke tests on `macos-latest`, and README install notes.

One PR, on `v2-macos`, released as **v1.1.0** (a new platform is a minor version; v2 in the roadmap is the phase, not the semver major).

**Owner's answers (2026-10-03):**
- unsigned for now;
- two DMGs (arm64 and x64);
- a terminal setting with auto-detect;
- no Mac to test on: CI only, and the README calls the macOS build a preview until someone has used it on a real Mac.

**Not in v2.0:** code signing or notarization, auto-update, Linux, other v2 tools (database panel, git glance and the rest come one per release afterwards).

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Where macOS code lives | `src/main/platform/darwin.ts` plus small pure parsers (`darwin-ports.ts`, `darwin-ps.ts`, `posix-shell.ts`), each with fixture tests. They are still the only files that know the OS. Only `platform/index.ts` reads `process.platform`. |
| 2 | Process groups | `spawnScript` and `spawnCommand` start the child with `detached: true`, which on POSIX makes it the leader of a new process group, so the whole tree can be signalled with `kill(-pgid)`. On Windows `detached` is not set (it would open a console window). `CommandRunner.spawn` gains a `newProcessGroup` option that only the darwin adapter passes. |
| 3 | `killTree` | `SIGTERM` to the group, poll up to 3 s, then `SIGKILL` to the group. Descendants that left the group (a daemonising dev server) are found with one `ps` call before the kill and get the same signals. `ESRCH` (already gone) is success. A user stop is still never a crash: `ProcessManager` already keys that on `stopRequested`, not on the exit code or signal. |
| 4 | Running scripts | `spawnScript` runs `<pm> run <script>` directly, with no shell: arguments are an array, so no quoting is needed. The package manager is resolved on the login-shell `PATH` (D5). `FORCE_COLOR=1` as on Windows. |
| 5 | Login-shell environment | Apps started from Finder or the Dock get a minimal `PATH` (no Homebrew, nvm, pnpm). `resolveShellEnv` runs `$SHELL -ilc` (falling back to `/bin/zsh`) with a command that prints a marker, `env -0` and the marker again. It parses only between the markers (shell profiles may print banners), times out after 10 s, and falls back to `process.env`. The result is cached for the app's lifetime; changing the editor or terminal setting clears it. Values are never logged; a failure logs only its code. |
| 6 | Listening ports | `lsof -nP -iTCP -sTCP:LISTEN -F pcn` (machine-readable fields: PID, command name, address). Grouped by port and PID like the Windows parser. Without root, `lsof` lists only the current user's sockets. That covers everything a developer starts (Homebrew's postgres and redis run as the user too). The Ports page shows a one-line note on macOS: "Ports of other users' processes need admin rights and are not listed." |
| 7 | Process list and command lines | `listProcesses`: `ps -axo pid=,ppid=,etime=`, with the start time computed as now − elapsed (`[[dd-]hh:]mm:ss`, accurate to 1 s, inside the orphan check's 3 s window). `describeProcesses`: `ps -ww -o pid=,command= -p <pids>`. Both run with `LC_ALL=C`. |
| 8 | Protected PIDs | Ports' kill rules add PID 1 (launchd) to the protected set (today 0 and 4), so neither platform can kill its init process. NestBox's own PID and ancestors stay protected as in M2. |
| 9 | Terminal setting | `terminalApp` already exists in the store as a free string defaulting to `'auto'`. `SettingsPatchSchema` takes `auto \| windows-terminal \| cmd \| terminal \| iterm \| ghostty`; an unknown stored value means `auto`. The Settings dialog lists only the current platform's options. **Windows:** `auto` = Windows Terminal, else cmd (today's behaviour), and choosing cmd skips `wt`. **macOS:** `auto` = iTerm2 when installed, else Terminal.app. |
| 10 | Opening a terminal on macOS | No AppleScript, so no Automation permission prompt. **Folder only:** `open -a <App> <cwd>` (Terminal, iTerm and Ghostty all open a window in that folder). **With a command** (`claude`, `claude --continue`): NestBox writes a temporary `.command` file (`cd '<cwd>' && <command>`, with the folder single-quoted and `'` escaped), marks it executable and runs `open -a <App> <file>`. Ghostty runs the command through `open -na Ghostty --args --working-directory=<cwd> -e <command words>`. Commands are NestBox-built tokens only, as on Windows; the temp file is removed after 60 s. |
| 11 | Editor | `openInEditor` resolves the editor command on the login-shell `PATH` and spawns it directly (`code -g path:line`). If the command is `code` and isn't on `PATH` (the "Install 'code' command" step was skipped), it falls back to `open -b com.microsoft.VSCode --args -g path:line`. Otherwise NOT_FOUND, with the same message as Windows. |
| 12 | `commandExists` | A pure `PATH` walk (login-shell `PATH`, `fs.access` with `X_OK`). No subprocess, never `null` on macOS. |
| 13 | Paths | APFS volumes are case-insensitive by default, so `normalizeDarwinPath` = `posix.resolve`, no trailing slash, Unicode NFC, lower case: comparison only, as on Windows. Paths are still stored and shown as typed. |
| 14 | Application menu | A small menu built from a pure template (`app-menu.ts`, tested): **NestBox** (About, Settings… `⌘,`, Hide, Hide Others, Show All, Quit `⌘Q` → quit controller); **Edit** (roles: undo/redo/cut/copy/paste/select all; without them `⌘C` and `⌘V` don't work in inputs); **View** (Reload and DevTools in dev builds only, plus full screen); **Window** (minimize, zoom, close `⌘W`). On Windows the menu stays null as today. |
| 15 | Dock and windows | `activate` (a Dock click) shows the window. Closing the window still hides it, or quits per the close-to-tray setting. `⌘Q` and Dock → Quit go through `before-quit` → quit controller, which already confirms when scripts run. |
| 16 | Title bar | `hiddenInset` traffic lights sit over the left of the title bar. The renderer reads `platform` from `app:getInfo` and gives the title bar 78 px left padding on macOS. Window Controls Overlay variables are Windows-only. |
| 17 | Menu-bar icon | The existing coloured icons, sized for the menu bar (16 px and 32 px @2x). `trayIconTheme: 'auto'` follows the system appearance, which on macOS is what the menu bar uses. The macOS default for `trayIconTheme` is `auto`. Not a template image: template images drop the coloured status hole that is the icon's whole point. Clicking the icon opens its menu (the macOS convention); "Show NestBox" is the menu's first item. |
| 18 | Shortcut hints | `modKey` from the platform (`⌘` or `Ctrl`) in the UI's hints (the prompt box's "Ctrl+Enter", palette hints). The palette already accepts `metaKey`. |
| 19 | Notifications | Electron's `Notification` works unsigned on macOS. `notificationAppId()` stays null. The first notification triggers the system permission prompt; denied means silent, with nothing to handle. |
| 20 | Packaging | `mac.target: dmg` with `arch: [arm64, x64]`, `artifactName: NestBox-${version}-${arch}.${ext}`, `identity: '-'` (ad-hoc: Apple Silicon refuses to run unsigned code at all), `hardenedRuntime: false`, category `public.app-category.developer-tools`, icon from the existing 512 px PNG (electron-builder makes the `.icns`). |
| 21 | Release workflow | The release job becomes a matrix: `windows-latest` builds the NSIS installer, `macos-latest` builds both DMGs. Both upload to the same draft release (same `tag_name`; `action-gh-release` adds assets to the existing draft). The tag/version check runs in both. |
| 22 | CI | The `e2e` job becomes a matrix over `windows-latest` and `macos-latest`. The `package` job does the same: on macOS `electron-builder --mac --dir --arm64`, and the smoke test launches `release/*/mac-arm64/NestBox.app/Contents/MacOS/NestBox`. `darwin.integration.test.ts` runs real `lsof`, `ps`, process groups and the login shell; it is skipped elsewhere, like the win32 integration file. |
| 23 | README | A macOS install section: download the DMG for your Mac, drag to Applications, first launch through right-click → Open, or on macOS 15+ System Settings → Privacy & Security → Open Anyway. Marked **preview** until it has been used on a real Mac. The `xattr -dr com.apple.quarantine` command is mentioned for people who know it. |

## Security notes

- `resolveShellEnv` runs the user's own login shell with a fixed command line, reads only between markers, and never logs or stores values. Values reach scripts the same way they do on Windows (the spawned env).
- The `.command` file holds only the folder (single-quoted) and NestBox-built tokens. It is written under the OS temp folder with mode 0700 and deleted after 60 s.
- `kill(-pgid)` is sent only to process groups NestBox created: the PIDs come from the PID ledger or `ProcessManager`, never from IPC. Ports' foreign kills keep their M2 confirmation rules, plus PID 1.
- No AppleScript, so no Automation permission and no script injection surface.

## Testing

- **Unit (every OS):**
  - fixture outputs for `lsof -F` and `ps` (etime formats, odd command names), the env marker parser (banners, empty values, `=` in values), the `.command` builder (quotes, spaces, `$`), the macOS path normaliser, the terminal choice per setting and platform, and the app-menu template;
  - `killTree` with a fake process API: TERM, wait, KILL, `ESRCH`.
- **Integration (macOS CI):**
  - real `lsof` sees a listening socket;
  - `ps` lists a child with the right parent;
  - a script with a grandchild in its group is gone after `killTree`;
  - `resolveShellEnv` returns a `PATH` that contains `/usr/bin`;
  - `spawnCommand` stdin.
- **End-to-end (macOS CI):** the existing specs run on `macos-latest` (scripts, ports attribution, env, static, palette), plus the packaged smoke test against `NestBox.app`.
- **Renderer:** title-bar padding and `⌘` hints with a mocked `darwin` `getInfo`; the Settings dialog shows only the current platform's terminals.
