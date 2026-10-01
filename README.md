<p align="center">
  <img src="resources/brand/svg/nestbox-lockup-outlined.svg" alt="NestBox" width="340">
</p>

A desktop toolbox for Node.js and TypeScript projects. You add a project folder once, and NestBox gives you what a browser can't: run its scripts and read their logs, see which process holds port 3000 and stop it, keep `.env` files in step, serve a build to your phone, and hand the project to Claude Code with the right context.

Built with Electron, React and Vite. Windows first; macOS is next. Linux is not planned.

<!-- GIF placeholder: a 30-second capture (add a project, run scripts, kill a port, serve a build on a phone) goes here. -->

![Scripts and logs](docs/screenshots/scripts.png)

## What it does

| | |
| --- | --- |
| **Projects** | Detects the package manager, scripts, workspace packages, env files, Prisma, Docker Compose, the build output and Claude Code files. Workspace packages appear as sub-projects. |
| **Scripts and logs** | Start, stop and restart scripts (the whole process tree), run groups, auto-restart with backoff, and a virtualised log viewer with ANSI colours, JSON log levels, search and split panes. A tray icon shows what is running. |
| **Ports** | Every listening port on the machine, with the NestBox script that owns it. Stop the script, or kill a foreign process after confirming. "Port in use" errors in a log offer the fix. |
| **Env** | A matrix of keys across `.env`, `.env.example` and profiles (`.env.staging`, …): what is missing, empty or undocumented. Values stay masked until revealed. Edits keep comments and formatting, and profiles switch with a backup. |
| **Static** | Serves the build output with SPA fallback, CORS, no-cache and simulated latency. It can share on the LAN with a QR code, and HTTPS uses a self-signed certificate. Dotfiles are never served. |
| **Claude Code** | Shows whether the CLI is installed, previews and edits `CLAUDE.md`/`CLAUDE.local.md`, and lists commands, agents, skills, settings and MCP servers. It runs a quick `claude -p` prompt, and it writes a generated project-context block into `CLAUDE.md` after showing a diff. |
| **Command palette** | `Ctrl+K`: jump to a project or tool, run or stop any script, start run groups, open Claude in a terminal. |

<table>
  <tr>
    <td><img src="docs/screenshots/overview.png" alt="Project overview"></td>
    <td><img src="docs/screenshots/ports.png" alt="Ports"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/env.png" alt="Env files"></td>
    <td><img src="docs/screenshots/static.png" alt="Static server"></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/claude.png" alt="Claude Code"></td>
    <td><img src="docs/screenshots/palette.png" alt="Command palette"></td>
  </tr>
</table>

## Install

Download `NestBox-Setup-<version>.exe` from [Releases](https://github.com/dnovacik/nestbox/releases) and run it.

The installer is not code-signed yet, so Windows SmartScreen says "Windows protected your PC". Choose **More info → Run anyway**. The installer is built by GitHub Actions from the tagged commit ([release workflow](.github/workflows/release.yml)), so you can check what went into it.

## Development

Requirements: Node 22.12+, pnpm 10, Windows (scripts, ports and terminals use Windows APIs; macOS has stubs for now).

```bash
pnpm install
pnpm dev          # the app with hot reload
pnpm test         # Vitest: main/shared (node) and renderer (jsdom)
pnpm lint && pnpm typecheck
pnpm build        # main, preload and renderer into out/
pnpm e2e          # Playwright against the built app (Windows)
```

`node scripts/screenshots.mjs` (after `pnpm build`) recreates the screenshots above with demo projects. Run it under `xvfb-run` on Linux.

[CLAUDE.md](CLAUDE.md) has the folder layout, conventions and gotchas. [docs/nestbox-spec.md](docs/nestbox-spec.md) is the source of truth for scope.

### Releasing

1. Set `version` in `package.json` and merge to `main`.
2. Tag the commit `v<version>` and push the tag.
3. The release workflow tests, builds and attaches the installer to a **draft** GitHub Release. Review it and publish.

## Architecture

```text
┌──────────────── main process (Node) ─────────────────┐       ┌──────── renderer (sandboxed) ────────┐
│ ProjectService · StoreService (electron-store + Zod) │       │ React + TanStack Query + Zustand     │
│ ProcessManager · PortService · quit controller · tray│       │ shell: sidebar, tabs, palette        │
│ Tool host ── tools: scripts, env, static, claude, …  │◀─────▶│ tool panels (lazy) + overview cards  │
│ PlatformAdapter (win32 | darwin stub)                │  IPC  │ window.nestbox (preload bridge)      │
└──────────────────────────────────────────────────────┘       └──────────────────────────────────────┘
```

- **Typed IPC.** Every channel has a Zod input and output schema in `src/shared/channels.ts`. The router checks the sender's origin and validates each payload, then answers with an envelope (`{ ok, data }` or `{ ok: false, error: { code, message } }`). The renderer's typed client turns errors back into exceptions with a code.
- **Tools are modules.** A tool is a contract (methods with Zod schemas, plus events), a main half (handlers that get a `ToolContext`) and a renderer half (a panel and an optional overview card). The core routes `tools:invoke` to them generically: adding a tool never touches the channel list, the router or the shell.
- **Shared context.** Tools publish facts that other tools read. Scripts publishes running PIDs, which Ports uses to name the owner of a port; Env publishes `PORT`, which the overview shows.
- **One platform adapter.** Every OS-specific call (spawning through `cmd.exe`, `taskkill /T`, `netstat`, PowerShell process lists, terminals) lives behind `PlatformAdapter`. Lint rejects `process.platform` anywhere else.
- **Logs flow one way.** Main keeps a ring buffer per process and sends batches every 50 ms. The renderer virtualises the list. Exports send sequence numbers back, never text.

### How to write a tool

The smallest tool is `project-info`. Three files make it:

1. **Contract** (`src/shared/tools/project-info/contract.ts`): the definition and the methods.

   ```ts
   export const projectInfoDefinition: ToolDefinition<{}> = {
     id: 'project-info', name: 'Project info', icon: 'info',
     appliesTo: () => true, settingsSchema: z.strictObject({}),
   };
   export const projectInfoContract = defineContract({
     getFacts: { input: z.strictObject({}), output: DetectedProjectSchema },
   });
   ```

   Register both in `src/shared/tools/index.ts`.

2. **Main half** (`src/main/tools/project-info/index.ts`): handlers receive the project, shared facts, the platform adapter, the tool's own settings and an `emit` for events.

   ```ts
   export const projectInfoTool = defineMainTool({
     ...projectInfoDefinition,
     contract: projectInfoContract,
     handlers: { getFacts: async (ctx) => ctx.project },
   });
   ```

   Add it to `createMainTools` in `src/main/tools/index.ts`. A tool that needs core services (the process manager, a native dialog) is a factory; see `createScriptsTool(deps)`.

3. **Renderer half** (`src/renderer/tools/project-info/`): a lazy `Panel`, an optional `OverviewCard` and a hook that calls `api.tools.invoke('project-info', projectId, 'getFacts', {})`, fully typed from the contract. Register it in `src/renderer/tools/registry.ts`.

Events (`defineEvents`) push data from main, as the static server's request log does. Settings (`settingsSchema` plus `ctx.settings`) persist per project. [CLAUDE.md](CLAUDE.md#adding-a-tool) has the full checklist.

## Security model

- The renderer is sandboxed with `contextIsolation` and no Node integration, under a strict CSP. It reaches main only through a whitelist of channels, and main checks the sender's origin on every call.
- Env values are never stored or logged. The renderer gets one value only when you reveal or edit it, and copying puts the value on the clipboard from main.
- Arguments that pass through `cmd.exe` are restricted and escaped. Free text, such as a Claude prompt, goes through stdin and never a command line.
- The static server binds to localhost unless LAN sharing is on, never serves dotfiles, and leaves query strings out of its log.
- The app makes no network calls of its own: no telemetry, no update checks, and fonts are bundled.

## Roadmap

v1 (this release): projects, scripts and logs, ports, env, static server, Claude Code, command palette, Windows installer.

v2 starts with the macOS build, then adds one tool per release: database panel, git glance, TODO scanner, health checks, Docker Compose, mock API and request inspector. See [the spec](docs/nestbox-spec.md#v2-tools-out-of-scope-for-v1).

## License

[MIT](LICENSE)
