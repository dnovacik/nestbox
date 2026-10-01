# Nestbox

Electron + React desktop toolbox for Node/TypeScript projects. Windows first, macOS later (no Linux).
Source of truth: `docs/nestbox-spec.md`. Milestone designs and plans: `docs/superpowers/`. Visual reference: `docs/design/DESIGN-NOTES.md` (the prototype is look-only; the spec wins).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app with HMR (electron-vite) |
| `pnpm build` | Build main, preload and renderer into `out/` |
| `pnpm lint` | ESLint (includes the `process.platform` and hex-colour rules) |
| `pnpm typecheck` | `tsc` for the node and web projects |
| `pnpm test` | Vitest: `node` project (main/shared/preload) + `renderer` project (jsdom) |
| `pnpm vitest run --project renderer` | Renderer tests only |
| `pnpm format` | Prettier |

## Folder structure

```text
src/main/        Electron main. index.ts is the only file wiring real Electron objects.
  platform/      PlatformAdapter (win32 real, darwin stub). The ONLY place allowed to read process.platform.
  detection/     detectProject(): pure filesystem detection, no Electron imports
  store/         StoreService over electron-store (Zod + schemaVersion + migrations)
  projects/      ProjectService (add/remove/rename/pin/refresh, workspace lookup)
  ipc/           router (validates every payload), register, core-handlers
  tools/         tool host, shared context, main halves of tools
  security/      CSP, origin checks, webContents/session hardening
src/preload/     window.nestbox bridge (whitelisted channels, returns envelopes)
src/shared/      Zod schemas, channel contract, typed client, tool contracts
src/renderer/    React app: app/ (shell), tools/ (panels), components/ (ui = shadcn), lib/, state/
resources/brand/ Brand assets (packaged as extraResources → brand/)
```

## Conventions

- pnpm only. TypeScript strict with `noUncheckedIndexedAccess`; no `any`.
- Conventional commits, small and frequent.
- TDD: write the failing Vitest test first. Tests sit next to the source (`foo.ts` → `foo.test.ts`).
- Security: `contextIsolation` on, `nodeIntegration` off, sandboxed renderer, strict CSP (a meta tag in builds, a header in dev), whitelisted IPC, and the sender origin checked on every call.
- No `process.platform` outside `src/main/platform/`. Lint enforces this.
- Never store or log env values or project file contents. `Logger` fields are primitives only; log channel, tool, method, file names and codes.
- Paths are stored and displayed in their original casing. `normalizePath` is for comparison only (`samePath`, duplicate detection).
- Every Windows command argument goes through `src/main/platform/win32-escape.ts` (cmd.exe caret escaping; `;` → `\;` for `wt`).
- Renderer colours come from tokens in `src/renderer/styles/globals.css` only. Lint rejects hex literals elsewhere. Dark theme only for now; one accent (`brand`); flat (no glow or blur).
- Fonts are bundled through `@fontsource-variable/*`. No network calls.
- Renderer packages are devDependencies (Vite bundles them). `dependencies` holds only what main requires at runtime.

## IPC

- **Core channels.** Defined in `src/shared/channels.ts`, one Zod input/output schema per channel. Names are in `src/shared/ipc-names.ts`, which has no Zod dependency and is safe for the preload.
- **Envelopes.** Main returns `{ ok, data } | { ok: false, error: { code, message } }`. The preload passes it through unchanged, because `contextBridge` drops custom `Error` fields. `createNestboxClient` (`src/shared/client.ts`) unwraps it and throws `NestboxError` with the code.
- **Error codes:** `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `NOT_IMPLEMENTED`, `FORBIDDEN`, `INTERNAL`. Messages never contain payload values.

## Adding a tool

1. `src/shared/tools/<id>/contract.ts`: a `ToolDefinition` (id, name, lucide icon name, `appliesTo`, `settingsSchema`) and a `defineContract({...})` with Zod input/output per method.
2. Register it in `src/shared/tools/index.ts` (`toolContracts`, `toolDefinitions`).
3. `src/main/tools/<id>/index.ts`: `defineMainTool({ ...definition, contract, handlers })`. Handlers get a `ToolContext` (`project`, `shared`, `emit`, `platform`). Then register it in `src/main/tools/index.ts`.
4. `src/renderer/tools/<id>/`: a lazy `Panel`, an optional `OverviewCard`, and a data hook that calls `api.tools.invoke(id, projectId, method, input)`. Register it in `src/renderer/tools/registry.ts`, and add its icon to `src/renderer/tools/icons.ts`.
5. You never need to edit `channels.ts`, the router or the shell. The reference implementation is `project-info`.

## Gotchas

- **Dependency bundling.** electron-store is ESM-only, so it is bundled into the CommonJS main through `externalizeDeps.exclude`. The preload is fully bundled (`externalizeDeps: false`) because sandboxed preloads cannot `require` files.
- **Versions.** electron-vite 5 supports Vite ≤ 7, and typescript-eslint requires TypeScript < 6.1. Check both before bumping either.
- **pnpm.** Build scripts run only for packages listed in `pnpm.onlyBuiltDependencies`.
- **shadcn.** Generated components in `src/renderer/components/ui/` are excluded from lint. The style is `new-york` (Radix, `asChild`). Don't let the CLI rewrite `globals.css`.
- **Workspace ids.** A workspace package's id is `<rootId>::<relPath>`. Workspaces are derived live and never stored.
- Electron 44 ships no install script: the binary downloads lazily on the first `pnpm dev` (needs network once). `onlyBuiltDependencies` matters for esbuild.
- The shadcn CLI (4.21) may import `cn` from an npm package called "cn" — always rewrite to `@/lib/utils` and do not add that package. It also puts `radix-ui` under dependencies; move it to devDependencies.
- `cmdInvocation`/`assertCmdSafe` reject `"`, CR, LF and NUL (a `.cmd` shim re-parses `%*`, so quotes cannot be escaped safely). Only pass paths and Nestbox-built tokens.
- Packaged builds trust only the exact renderer entry file URL as the IPC/navigation origin (`isAppUrl`); dev trusts only the dev-server origin.
- Tests must wait for data with `findBy*`; never change product markup (e.g. swap landmarks) to satisfy test timing.
