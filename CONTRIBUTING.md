# Contributing to NestBox

Thanks for taking a look. NestBox is a small project with a fixed scope, so please open an issue before starting anything large: [the spec](docs/nestbox-spec.md) decides what belongs in it, and its non-goals (not an API client, not a box of generic utilities) are deliberate.

## Setup

Node 22.12+ and pnpm 10, on Windows or macOS. Linux works for development (the app runs with the macOS adapter, without the ports list).

```bash
pnpm install      # also downloads the Electron binary once
pnpm dev          # the app with hot reload
```

## Before you open a pull request

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm e2e    # end-to-end tests; xvfb-run on Linux
```

CI runs the same checks on Windows and macOS, plus a packaged build.

- **Tests first.** Write the failing Vitest test, then the code. Tests sit next to the source (`foo.ts` → `foo.test.ts`). Renderer tests wait for data with `findBy*`.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(env): …`, `fix(ports): …`), small and focused.
- **Formatting:** `pnpm prettier --write <your files>`. Don't run `pnpm format` across the repo: it rewrites files you didn't touch.
- **TypeScript** is strict with `noUncheckedIndexedAccess`. No `any`.

## Rules that reviews check

- `process.platform` is read only in `src/main/platform/`. Everything OS-specific goes through the `PlatformAdapter`.
- Every IPC payload is validated with Zod in main, and every channel or tool method has a schema. The renderer never gets Node access.
- Env values and project file contents are never logged or stored. Logger fields are primitives: ids, codes, file names.
- Commands built for cmd.exe go through `cmdInvocation`. Free text reaches a process only on stdin.
- Renderer colours come from the tokens in `src/renderer/styles/globals.css` (lint rejects hex literals elsewhere). The app is dark-only and flat, with one accent.
- No network calls of NestBox's own: no telemetry, no CDNs, bundled fonts.

## Adding a tool

Most features are tools: a contract in `src/shared/tools/<id>/`, a main half in `src/main/tools/<id>/` and a panel in `src/renderer/tools/<id>/`. The README's [How to write a tool](README.md#how-to-write-a-tool) walks through it, and [CLAUDE.md](CLAUDE.md#adding-a-tool) has the checklist. You never need to edit the IPC router or the app shell.

Larger tools get a short design note in `docs/superpowers/specs/` first, listing the decisions and what is out of scope.

## Reporting bugs

Open an issue with your OS, the NestBox version (the title bar shows it), and the steps. NestBox's own log goes to the console: run the app with `pnpm dev`, or start the installed app from a terminal, to see it. It holds ids and error codes only, never env values or file contents.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
