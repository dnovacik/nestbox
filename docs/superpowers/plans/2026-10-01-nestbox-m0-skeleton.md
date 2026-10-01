# Nestbox M0 (Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a launchable Windows-first Electron app. It shows a shell, a sidebar and an empty state; it can add, remove, rename and pin projects, which persist; it detects what each project folder contains; its IPC is typed and validated; it has a tool registry proven by one real tool ("Project info"); it has a platform adapter (a Windows implementation and a macOS stub); and CI runs on Windows and macOS.

**Architecture:**
- **Main process (Node).** Holds every service: store, detection, projects, tool host, platform adapter. Each one is a plain module with injected dependencies, so it can be unit tested without Electron. `src/main/index.ts` is the only place that wires real Electron objects together.
- **Preload.** Exposes a whitelisted `window.nestbox` bridge that returns result envelopes.
- **Renderer.** A shared typed client turns those envelopes into typed promises or a thrown `NestboxError`.
- **Tools.** Each tool declares a Zod contract in `src/shared/tools/<id>/`. They are reached through one generic `tools:invoke` channel.

**Tech stack (versions checked 2026-10-01):**

| Area | Packages |
| --- | --- |
| Shell and build | Electron 44.5.1, electron-vite 5.0.0, Vite 7.3.6 (electron-vite 5 supports Vite ≤ 7), electron-builder 26.15.3 |
| Language | TypeScript 6.0.3 (typescript-eslint 8.71 requires TypeScript < 6.1, so not 7.x) |
| UI | React 19.3, Tailwind 4.3.3, shadcn CLI 4.21.0 with the `new-york` (Radix) style, lucide-react 1.49 |
| State | TanStack Query 5.104, Zustand 5.0.15 |
| Validation and storage | Zod 4.6.5, electron-store 11.0.2 (ESM-only; bundled into the CommonJS main) |
| Detection | yaml 2.9.1, tinyglobby 0.2.17 |
| Tests | Vitest 5.0.3, jsdom 30.1.1, Testing Library |
| Lint and format | ESLint 10.11, Prettier 3.9.9 |

**Spec:** `docs/nestbox-spec.md` (source of truth) and `docs/superpowers/specs/2026-10-01-nestbox-m0-design.md` (approved M0 design). For the look, also `docs/design/DESIGN-NOTES.md` and `docs/design/prototype.tsx` (visual reference only).

## Global Constraints

**Toolchain**
- Package manager is pnpm (10.30.2 locally). `"packageManager": "pnpm@10.30.2"`. Node ≥ 22.12.
- TypeScript is `strict` with `noUncheckedIndexedAccess`. Do not use `any`; use `unknown` and narrow.
- Conventional commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `ci:`, `refactor:`), small and frequent. Every commit message ends with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

**Electron security**
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Strict CSP. Only whitelisted IPC channels.

**Rules for code**
- No `process.platform` outside `src/main/platform/`. An ESLint rule enforces it.
- Never store or log env values, or the contents of any project file. Logs carry channel, tool, method, file names, durations and error codes only.
- Paths are stored and displayed with their original casing. `normalizePath` is a comparison key only, used by `samePath` and duplicate detection.
- No hex colour literals in `src/renderer/**` outside `src/renderer/styles/globals.css`. An ESLint rule enforces it.

**Scope**
- No network calls. Fonts are bundled through `@fontsource-variable/*`. No telemetry, no accounts, no Linux, no v2 tools.
- M0 is dark theme only. One accent, `#7C8CFF`. Flat: no glow, no backdrop blur, no pulsing dots, no purple.
- Do not copy anything from DESIGN-NOTES' "Do not copy" table, and nothing the design notes defer to M1–M3: tray, Stop all, process/port counts, Claude button, command palette.

## Review Focus

These are inputs the spec implies but doesn't spell out. Each one has a test in the task named.

1. **The project folder is deleted or renamed while the app runs, then the user clicks "Open in VS Code" or "Open terminal here".** Expect a "The project folder no longer exists" error toast and the project re-marked as missing, not a silent failure. Tested in Task 13 (`core-handlers.test.ts`).
2. **The same folder is added twice with different casing or a trailing separator** (`C:\Dev\Shop` and `c:\dev\shop\`). Expect a `CONFLICT` error naming the existing project. Tested in Task 9 (`project-service.test.ts`), using the Windows `samePath` from Task 5.
3. **Malformed project files:** a `package.json` with a BOM, invalid JSON, a non-object root, or a broken `pnpm-workspace.yaml`. Detection must still succeed, and the warning must name the file only, never its content. Tested in Tasks 6 and 7.
4. **Workspace globs that reach into `node_modules`, overlap, or use `**`.** Expect no `node_modules` packages, no duplicates and no root entry. Tested in Task 7.
5. **The store file is corrupt JSON, fails validation, or comes from a newer app version.** The app must still start: the file is backed up to `config.corrupt-<ts>.json` and defaults are used. Tested in Task 8.

---

## File Map

```text
.github/workflows/ci.yml           CI matrix windows-latest + macos-latest
CLAUDE.md, README.md, LICENSE      docs (Task 0, Task 17)
electron.vite.config.ts            main/preload/renderer build config + CSP meta plugin
electron-builder.yml               packaging config (installer itself lands in M3)
eslint.config.mjs                  flat config incl. process.platform + hex-colour rules
vitest.config.ts                   two projects: node, renderer (jsdom)
tsconfig.json / tsconfig.node.json / tsconfig.web.json
components.json                    shadcn config
resources/brand/**                 brand assets (moved from docs/resources/brand)
tests/lint/eslint-rules.test.ts    proves the two custom lint rules

src/shared/
  is-record.ts                     isRecord type guard
  errors.ts                        ErrorCode, NestboxError, IpcEnvelope, describeIssues
  types.ts                         Project, AppSettings, StoreData, AppInfo schemas
  detected.ts                      DetectedProject, ProjectSummary schemas, workspace id helpers
  ipc-names.ts                     channel/event name lists (no zod — preload-safe)
  channels.ts                      Zod input/output schema per core channel
  bridge.ts                        NestboxBridge type (window.nestbox)
  client.ts                        createNestboxClient — typed promises over the bridge
  tool.ts                          ToolDefinition, ToolContract, defineContract, ToolSummary
  tools/index.ts                   toolContracts + toolDefinitions registry + type helpers
  tools/project-info/contract.ts   Project info definition + contract

src/main/
  index.ts                         app lifecycle + wiring (only file that touches real Electron objects broadly)
  window.ts                        createMainWindow
  window-theme.ts                  window/overlay colours
  assets.ts                        brand asset path resolution (dev vs packaged)
  logger.ts                        Logger with primitive-only fields
  security/origin.ts               isAppUrl
  security/csp.ts                  buildCsp
  security/harden.ts               hardenWebContents, applySessionSecurity
  platform/adapter.ts              PlatformAdapter, CommandRunner, types, notImplemented
  platform/paths.ts                normalizeWin32Path, normalizePosixPath
  platform/win32-escape.ts         cmd.exe + wt argument escaping
  platform/command-runner.ts       spawnRunner (real CommandRunner)
  platform/win32.ts                createWin32Adapter
  platform/darwin.ts               createDarwinAdapter (stub)
  platform/index.ts                createPlatformAdapter — the only process.platform read
  detection/fs-utils.ts            statOrNull, isDirectory, isFile
  detection/git-head.ts            readGitInfo
  detection/package-manager.ts     detectPackageManager
  detection/workspaces.ts          findWorkspaceDirs
  detection/detect-project.ts      detectProject
  detection/test-fixtures.ts       makeTree temp-folder helper (tests only)
  store/backend.ts                 StoreBackend + createMemoryBackend
  store/migrations.ts              MIGRATIONS, migrate, MigrationError
  store/store-service.ts           StoreService
  store/electron-store-backend.ts  electron-store backed StoreBackend
  projects/project-service.ts      ProjectService
  ipc/router.ts                    createRouter → dispatch(channel, senderUrl, payload)
  ipc/register.ts                  registerIpc(ipcMain, dispatch)
  ipc/core-handlers.ts             createCoreHandlers
  tools/types.ts                   ToolContext, MainTool, AnyMainTool, defineMainTool
  tools/shared-context.ts          createSharedContext
  tools/tool-host.ts               createToolHost
  tools/project-info/index.ts      projectInfoTool (main half)
  tools/index.ts                   mainTools registry

src/preload/
  bridge.ts                        createBridge(ipcRenderer) with whitelist
  index.ts                         contextBridge.exposeInMainWorld('nestbox', …)

src/renderer/
  index.html, main.tsx, env.d.ts
  styles/globals.css               tokens + Tailwind theme + shadcn variable mapping
  lib/utils.ts (cn), lib/api.ts (client instance), lib/queries.ts (TanStack hooks), lib/errors.ts
  state/ui-store.ts                Zustand UI state
  app/App.tsx, TitleBar.tsx, Sidebar.tsx, StatusBar.tsx, EmptyState.tsx,
      ProjectView.tsx, ProjectHeader.tsx, RenameInput.tsx, ToolTabs.tsx, OverviewGrid.tsx, find-project.ts
  components/NestboxMark.tsx, components/ui/* (shadcn, generated)
  tools/types.ts, tools/registry.ts, tools/icons.ts
  tools/project-info/index.ts, Panel.tsx, OverviewCard.tsx, use-facts.ts
  test/setup.ts, test/mock-bridge.ts, test/fixtures.ts, test/render.tsx
```

Test files sit next to their source (`foo.ts` → `foo.test.ts`). The Vitest `node` project runs `src/{main,preload,shared}/**/*.test.ts` and `tests/**/*.test.ts`. The `renderer` project (jsdom) runs `src/renderer/**/*.test.{ts,tsx}`.

---

### Task 0: Repository bootstrap (controller, on `main`, before the worktree)

This runs in the main checkout at `D:\_dev\_nestbox`. There is no product code yet.

**Files:**
- Create: `LICENSE`, `.gitignore`, `.gitattributes`, `.editorconfig`, `README.md`

- [ ] **Step 1: Initialise git on `main`**

```bash
cd /d/_dev/_nestbox
git init -b main
```

Set the repo-local identity (the user confirmed it during plan review; the global email is a work address):

```bash
git config user.name "Daniel Novacik"
git config user.email "novacik.daniel@gmail.com"
```

- [ ] **Step 2: Write `LICENSE`** (MIT; the copyright holder is the name confirmed during plan review)

```text
MIT License

Copyright (c) 2026 Daniel Novacik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Write `.gitignore`**

```gitignore
node_modules/
out/
dist/
release/
coverage/
.worktrees/
*.log
.DS_Store
Thumbs.db
.env
.env.*
!.env.example
.idea/
.vscode/*
!.vscode/extensions.json
```

- [ ] **Step 4: Write `.gitattributes`**

```gitattributes
* text=auto eol=lf
*.png binary
*.ico binary
```

- [ ] **Step 5: Write `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 6: Write the stub `README.md`**

```markdown
# nestbox

A local developer toolbox for Node.js and TypeScript projects: run scripts and read their logs, free stuck ports, keep `.env` files in order, serve a build, and hand a project to Claude Code.

> Work in progress: milestone M0 (skeleton). Windows first; macOS later.

## License

[MIT](LICENSE)
```

- [ ] **Step 7: Commit**

```bash
git add LICENSE .gitignore .gitattributes .editorconfig README.md docs
git commit -m "chore: initial commit with spec, design notes and plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `git log --oneline` shows exactly one commit, and `git status` is clean.

- [ ] **Step 7b: Add the GitHub remote and push `main`**

The user created an empty GitHub repo. Use the exact URL the user gave. Pushing needs `gh auth login` done once by the user and `gh auth setup-git`.

```bash
git remote add origin <repo URL from the user>
git push -u origin main
```

Expected: `git ls-remote origin main` prints the same hash as `git rev-parse main`.

- [ ] **Step 8: Create the milestone worktree.** Use superpowers:using-git-worktrees with branch `m0-skeleton` at `.worktrees/m0-skeleton`. All later tasks run inside that worktree.

---

### Task 1: Toolchain scaffold: the app boots and the lint rules are proven

**Files:**
- Move: `docs/resources/brand/` → `resources/brand/`
- Create: `package.json`, `.npmrc`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`
- Create (temporary minimal app, replaced in Tasks 13/14): `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/env.d.ts`
- Create: `src/main/security/csp.ts` (needed by the build config; tests in Task 13)
- Test: `tests/lint/eslint-rules.test.ts`

**Interfaces:**
- Produces: the `pnpm dev | build | lint | typecheck | test | format` scripts; the path aliases `@shared/*` → `src/shared/*`, `@/*` → `src/renderer/*`, `@brand/*` → `resources/brand/*`; and `buildCsp(options: { dev: boolean }): string` from `src/main/security/csp.ts`.

- [ ] **Step 1: Move the brand assets**

```bash
git mv docs/resources/brand resources/brand
```

`DESIGN-NOTES.md` already refers to `resources/brand/`, so it needs no edit.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "nestbox",
  "version": "0.0.0",
  "private": true,
  "description": "Local developer toolbox for Node.js and TypeScript projects",
  "license": "MIT",
  "author": "Daniel Novacik",
  "main": "./out/main/index.js",
  "packageManager": "pnpm@10.30.2",
  "engines": {
    "node": ">=22.12"
  },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit --composite false -p tsconfig.node.json && tsc --noEmit --composite false -p tsconfig.web.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["electron", "esbuild"]
  }
}
```

- [ ] **Step 3: Write `.npmrc`.** electron-vite and electron-builder both resolve modules more reliably from a hoisted layout.

```ini
shamefully-hoist=true
```

- [ ] **Step 4: Install the dependencies (exact versions)**

```bash
pnpm add zod@4.6.5 yaml@2.9.1 tinyglobby@0.2.17 electron-store@11.0.2
pnpm add -D electron@44.5.1 electron-vite@5.0.0 electron-builder@26.15.3 vite@7.3.6 @vitejs/plugin-react@5.2.0 typescript@6.0.3 @types/node@24 react@19.3.0 react-dom@19.3.0 @types/react@19.3.0 @types/react-dom@19.3.0 vitest@5.0.3 jsdom@30.1.1 @testing-library/react@16.3.3 @testing-library/dom@10.4.2 @testing-library/user-event@14.6.7 @testing-library/jest-dom@7.0.1 eslint@10.11.0 @eslint/js@10.0.1 typescript-eslint@8.71.0 eslint-plugin-react-hooks@7.1.1 eslint-config-prettier@10.1.8 globals@17.13.0 prettier@3.9.9
```

Expected: the install finishes, and `node_modules/electron/dist/electron.exe` exists. That file is created by Electron's install script, which `onlyBuiltDependencies` allows. If pnpm reports ignored build scripts, run `pnpm approve-builds` and approve `electron` and `esbuild`.

- [ ] **Step 5: Write `src/main/security/csp.ts`.** The build config imports it to inject the production CSP meta tag.

```ts
export interface CspOptions {
  /** true while running against the Vite dev server (HMR needs inline scripts and websockets). */
  dev: boolean;
}

export function buildCsp({ dev }: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    // Radix and sonner inject <style> at runtime; scripts stay strict.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': dev ? ["'self'", 'ws://localhost:*', 'ws://127.0.0.1:*'] : ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}
```

- [ ] **Step 6: Write `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { buildCsp } from './src/main/security/csp';

const shared = resolve('src/shared');

/** Injects the strict production CSP as a <meta> tag. Dev CSP is set as a header by main. */
function cspMeta(): Plugin {
  return {
    name: 'nestbox-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp({ dev: false })}" />`;
      return html.replace('<head>', `<head>\n    ${meta}`);
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } },
    // electron-store is ESM-only; bundle it into the CommonJS main bundle.
    build: { externalizeDeps: { exclude: ['electron-store'] } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    // Sandboxed preload cannot require() files: bundle everything.
    build: { externalizeDeps: false },
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer'),
        '@shared': shared,
        '@brand': resolve('resources/brand'),
      },
    },
    plugins: [react(), cspMeta()],
  },
});
```

Task 14 adds the Tailwind and svgr plugins.

- [ ] **Step 7: Write the tsconfigs**

`tsconfig.json`:

```json
{
  "files": [],
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/renderer/*"],
      "@shared/*": ["./src/shared/*"],
      "@brand/*": ["./resources/brand/*"]
    }
  },
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["node"],
    "paths": { "@shared/*": ["./src/shared/*"] }
  },
  "include": [
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*",
    "tests/**/*",
    "electron.vite.config.ts",
    "vitest.config.ts"
  ]
}
```

`tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["vite/client"],
    "paths": {
      "@/*": ["./src/renderer/*"],
      "@shared/*": ["./src/shared/*"],
      "@brand/*": ["./resources/brand/*"]
    }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

Note: TypeScript 6 defaults `types` to `[]`, so every project lists its ambient types explicitly. Do not add `baseUrl`, which TypeScript 6 deprecates; `paths` works without it.

- [ ] **Step 8: Write `vitest.config.ts`**

```ts
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const alias = {
  '@': resolve('src/renderer'),
  '@shared': resolve('src/shared'),
  '@brand': resolve('resources/brand'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{main,preload,shared}/**/*.test.ts', 'tests/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          passWithNoTests: true,
        },
      },
    ],
  },
});
```

- [ ] **Step 9: Write `eslint.config.mjs`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const HEX = '/#[0-9a-fA-F]{3,8}\\b/';
const HEX_MESSAGE = 'No hex colours in renderer code; use the theme tokens from styles/globals.css.';

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'docs/**',
      '.worktrees/**',
      'src/renderer/components/ui/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'platform',
          message: 'OS checks belong in src/main/platform/ (PlatformAdapter).',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/main/platform/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${HEX}]`, message: HEX_MESSAGE },
        { selector: `TemplateElement[value.raw=${HEX}]`, message: HEX_MESSAGE },
      ],
    },
  },
  prettier,
);
```

- [ ] **Step 10: Write the Prettier config**

`.prettierrc.json`:

```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

`.prettierignore`:

```text
out
dist
release
coverage
docs
pnpm-lock.yaml
resources
src/renderer/components/ui
```

- [ ] **Step 11: Write the failing lint-rule test** at `tests/lint/eslint-rules.test.ts`

```ts
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'fatal');
}

describe('custom lint rules', () => {
  it('rejects process.platform outside src/main/platform', async () => {
    const ids = await ruleIds('export const p = process.platform;\n', 'src/main/services/x.ts');
    expect(ids).toContain('no-restricted-properties');
  });

  it('allows process.platform inside src/main/platform', async () => {
    const ids = await ruleIds('export const p = process.platform;\n', 'src/main/platform/x.ts');
    expect(ids).not.toContain('no-restricted-properties');
  });

  it('rejects process.platform in the renderer', async () => {
    const ids = await ruleIds('export const p = process.platform;\n', 'src/renderer/x.ts');
    expect(ids).toContain('no-restricted-properties');
  });

  it('rejects hex colours in renderer string and template literals', async () => {
    const a = await ruleIds("export const c = 'bg-[#0D1117]';\n", 'src/renderer/app/x.tsx');
    const b = await ruleIds('export const c = `text-[#fff] ${1}`;\n', 'src/renderer/app/x.tsx');
    expect(a).toContain('no-restricted-syntax');
    expect(b).toContain('no-restricted-syntax');
  });

  it('allows hex colours in main-process code', async () => {
    const ids = await ruleIds("export const c = '#161B22';\n", 'src/main/window-theme.ts');
    expect(ids).not.toContain('no-restricted-syntax');
  });
});
```

- [ ] **Step 12: Run the test and confirm it passes against the config from Step 9**

Run: `pnpm vitest run tests/lint`
Expected: all 5 tests pass. If one fails, the config is wrong, not the test: fix `eslint.config.mjs`. To prove the test can fail, temporarily delete the `no-restricted-properties` block, re-run and see 2 failures, then restore it.

- [ ] **Step 13: Write the temporary minimal app**

`src/main/index.ts` (Task 13 replaces it):

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
```

`src/preload/index.ts` (Task 12 replaces it):

```ts
export {};
```

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Nestbox</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`src/renderer/env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`src/renderer/main.tsx` (Task 14 replaces it):

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <p>nestbox</p>
  </StrictMode>,
);
```

- [ ] **Step 14: Verify the whole toolchain**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: no lint errors, no type errors, 5 tests passing, and `out/main/index.js`, `out/preload/index.js` and `out/renderer/index.html` present. `out/renderer/index.html` must contain `Content-Security-Policy`:

Run: `grep -c "Content-Security-Policy" out/renderer/index.html` and expect `1`.

- [ ] **Step 15: Smoke-run the app**

Run: `pnpm dev` and expect an Electron window showing "nestbox". Close it. On a headless agent, record "not visually verified" and continue. The controller verifies `pnpm dev` manually in Task 17.

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite toolchain with lint, typecheck and tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the `pnpm lint | typecheck | test` scripts from Task 1.

- [ ] **Step 1: Write the workflow** (action versions are the latest releases as of 2026-10-01)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    name: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

`pnpm/action-setup` reads the pnpm version from `packageManager`.

- [ ] **Step 2: Validate the YAML locally** (and run `pnpm build` once to confirm the step CI will run passes)

Run: `node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8')); console.log('ok')"`
Expected: `ok`. The real run happens once the repo is pushed; the user decides when to push.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint, typecheck, test and build on windows-latest and macos-latest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push the branch and open a draft PR** (controller step, so CI runs on every push during M0)

```bash
git push -u origin m0-skeleton
gh pr create --draft --base main --head m0-skeleton --title "M0: Skeleton" --body "Milestone M0 (Skeleton). Plan: docs/superpowers/plans/2026-10-01-nestbox-m0-skeleton.md. Design: docs/superpowers/specs/2026-10-01-nestbox-m0-design.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch
```

Expected: the draft PR exists, and the `CI` workflow runs on both OSes and goes green. From now on, push after every task: `git push`.

---

### Task 3: Shared model: errors, persisted types, detected-project types

**Files:**
- Create: `src/shared/is-record.ts`, `src/shared/errors.ts`, `src/shared/types.ts`, `src/shared/detected.ts`
- Test: `src/shared/errors.test.ts`, `src/shared/types.test.ts`, `src/shared/detected.test.ts`

**Interfaces:**
- Produces:
  - **`is-record.ts`:** `isRecord(v: unknown): v is Record<string, unknown>`.
  - **`errors.ts`:**
    - `ERROR_CODES` and `type ErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'NOT_IMPLEMENTED' | 'FORBIDDEN' | 'INTERNAL'`. `FORBIDDEN` is added for untrusted IPC senders.
    - `class NestboxError extends Error { code: ErrorCode }`.
    - `type IpcEnvelope<T>`, `ok<T>(data): IpcEnvelope<T>`, `fail(code, message): IpcEnvelope<never>`.
    - `describeIssues(error: z.ZodError): string`.
  - **`types.ts`:**
    - `ProjectNameSchema`, `ProjectSchema`/`Project`, `AppSettingsSchema`/`AppSettings`.
    - `CURRENT_SCHEMA_VERSION = 1`, `StoreDataSchema`/`StoreData`, `defaultStoreData(): StoreData`.
    - `PLATFORM_IDS`, `type PlatformId = 'win32' | 'darwin'`, `AppInfoSchema`/`AppInfo`.
  - **`detected.ts`:**
    - `PACKAGE_MANAGERS`, `PackageManager`, `GitInfo`, `ClaudeFiles`.
    - `DetectedProject`, `DetectedProjectSchema`, `ProjectSummary`, `ProjectSummarySchema`.
    - `WORKSPACE_ID_SEPARATOR = '::'`, `workspaceId(rootId, relPath)`, `splitProjectId(id): { rootId; relPath }`, `findDetected(root, id): DetectedProject | null`.

- [ ] **Step 1: Write the failing tests**

`src/shared/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { describeIssues, fail, NestboxError, ok } from './errors';

describe('errors', () => {
  it('NestboxError carries a code and is an Error', () => {
    const e = new NestboxError('CONFLICT', 'already added');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('CONFLICT');
    expect(e.name).toBe('NestboxError');
  });

  it('builds envelopes', () => {
    expect(ok(1)).toEqual({ ok: true, data: 1 });
    expect(fail('NOT_FOUND', 'nope')).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } });
  });

  it('describeIssues names paths and codes but never the received values', () => {
    const r = z.object({ name: z.string(), pinned: z.boolean() }).safeParse({ name: 5, pinned: 'SECRET_VALUE' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const text = describeIssues(r.error);
    expect(text).toContain('name');
    expect(text).toContain('pinned');
    expect(text).not.toContain('SECRET_VALUE');
  });
});
```

`src/shared/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AppSettingsSchema, defaultStoreData, ProjectNameSchema, ProjectSchema, StoreDataSchema } from './types';

describe('persisted types', () => {
  it('fills project defaults from id, name and path only', () => {
    const p = ProjectSchema.parse({ id: 'a', name: 'shop', path: 'C:\\Dev\\Shop' });
    expect(p).toEqual({
      id: 'a',
      name: 'shop',
      path: 'C:\\Dev\\Shop',
      tags: [],
      pinned: false,
      runGroups: [],
      envProfiles: [],
      toolSettings: {},
    });
  });

  it('keeps path casing exactly as given', () => {
    expect(ProjectSchema.parse({ id: 'a', name: 'x', path: 'C:\\Dev\\MixedCase' }).path).toBe('C:\\Dev\\MixedCase');
  });

  it('trims project names and rejects empty or over-long ones', () => {
    expect(ProjectNameSchema.parse('  shop  ')).toBe('shop');
    expect(ProjectNameSchema.safeParse('   ').success).toBe(false);
    expect(ProjectNameSchema.safeParse('x'.repeat(101)).success).toBe(false);
  });

  it('has sensible app setting defaults', () => {
    expect(AppSettingsSchema.parse({})).toEqual({
      theme: 'system',
      editorCommand: 'code',
      terminalApp: 'auto',
      logBufferLines: 50_000,
      closeToTray: true,
    });
  });

  it('default store data is valid and versioned', () => {
    const d = defaultStoreData();
    expect(d.schemaVersion).toBe(1);
    expect(StoreDataSchema.parse(d)).toEqual(d);
  });

  it('rejects store data with a different schemaVersion', () => {
    expect(StoreDataSchema.safeParse({ ...defaultStoreData(), schemaVersion: 2 }).success).toBe(false);
  });
});
```

`src/shared/detected.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { type DetectedProject, DetectedProjectSchema, findDetected, splitProjectId, workspaceId } from './detected';

function project(overrides: Partial<DetectedProject> = {}): DetectedProject {
  return {
    id: 'root',
    rootId: 'root',
    path: 'C:\\Dev\\Shop',
    relPath: '',
    name: 'shop',
    missing: false,
    packageJson: { name: 'shop', scripts: { dev: 'vite' } },
    packageManager: 'pnpm',
    envFiles: ['.env', '.env.example'],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null,
    git: { branch: 'main', head: null },
    buildOutput: null,
    claude: { claudeMd: true, claudeLocalMd: false, claudeDir: false, mcpJson: false },
    ...overrides,
  };
}

describe('detected project helpers', () => {
  it('builds and splits workspace ids', () => {
    const id = workspaceId('abc', 'packages/api');
    expect(id).toBe('abc::packages/api');
    expect(splitProjectId(id)).toEqual({ rootId: 'abc', relPath: 'packages/api' });
    expect(splitProjectId('abc')).toEqual({ rootId: 'abc', relPath: '' });
  });

  it('finds the root or a workspace by id', () => {
    const ws = project({ id: 'root::packages/api', relPath: 'packages/api', name: 'api' });
    const root = project({ workspaces: [ws] });
    expect(findDetected(root, 'root')).toBe(root);
    expect(findDetected(root, 'root::packages/api')).toBe(ws);
    expect(findDetected(root, 'root::nope')).toBeNull();
  });

  it('validates recursively and strips unknown fields', () => {
    const ws = project({ id: 'root::a', relPath: 'a' });
    const parsed = DetectedProjectSchema.parse({ ...project({ workspaces: [ws] }), leaked: 'x' });
    expect(parsed).not.toHaveProperty('leaked');
    expect(parsed.workspaces[0]?.id).toBe('root::a');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/shared`
Expected: all three files fail with module-not-found errors.

- [ ] **Step 3: Implement `src/shared/is-record.ts`**

```ts
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Implement `src/shared/errors.ts`**

```ts
import type { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'NOT_IMPLEMENTED',
  'FORBIDDEN',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class NestboxError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'NestboxError';
    this.code = code;
  }
}

export type IpcEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

export function ok<T>(data: T): IpcEnvelope<T> {
  return { ok: true, data };
}

export function fail(code: ErrorCode, message: string): IpcEnvelope<never> {
  return { ok: false, error: { code, message } };
}

/** Path + issue code only. Never includes received values (they may be secrets). */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.code}`)
    .join(', ');
}
```

- [ ] **Step 5: Implement `src/shared/types.ts`**

```ts
import { z } from 'zod';

export const ProjectNameSchema = z.string().trim().min(1).max(100);

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: ProjectNameSchema,
  /** Absolute path with its original casing. Never normalised for storage. */
  path: z.string().min(1),
  tags: z.array(z.string()).default([]),
  pinned: z.boolean().default(false),
  runGroups: z.array(z.object({ name: z.string().min(1), scripts: z.array(z.string()) })).default([]),
  envProfiles: z.array(z.object({ name: z.string().min(1), file: z.string().min(1) })).default([]),
  staticServer: z
    .object({
      folder: z.string(),
      port: z.number().int().min(1).max(65535),
      spa: z.boolean(),
      https: z.boolean(),
    })
    .optional(),
  /** Per tool id, owned and validated by the tool. */
  toolSettings: z.record(z.string(), z.unknown()).default({}),
});
export type Project = z.infer<typeof ProjectSchema>;

export const AppSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  editorCommand: z.string().min(1).default('code'),
  /** 'auto' lets the platform adapter pick (wt with cmd fallback on Windows). */
  terminalApp: z.string().min(1).default('auto'),
  logBufferLines: z.number().int().min(1_000).max(1_000_000).default(50_000),
  closeToTray: z.boolean().default(true),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const CURRENT_SCHEMA_VERSION = 1;

export const StoreDataSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  settings: AppSettingsSchema,
  projects: z.array(ProjectSchema),
});
export type StoreData = z.infer<typeof StoreDataSchema>;

export function defaultStoreData(): StoreData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, settings: AppSettingsSchema.parse({}), projects: [] };
}

export const PLATFORM_IDS = ['win32', 'darwin'] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

export const AppInfoSchema = z.object({
  version: z.string(),
  platform: z.enum(PLATFORM_IDS),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;
```

- [ ] **Step 6: Implement `src/shared/detected.ts`**

```ts
import { z } from 'zod';

export const PACKAGE_MANAGERS = ['pnpm', 'yarn', 'npm', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

export interface GitInfo {
  /** Current branch, or null when HEAD is detached or unreadable. */
  branch: string | null;
  /** 7-char commit hash when HEAD is detached, otherwise null. */
  head: string | null;
}

export interface ClaudeFiles {
  claudeMd: boolean;
  claudeLocalMd: boolean;
  claudeDir: boolean;
  mcpJson: boolean;
}

export interface DetectedProject {
  id: string;
  rootId: string;
  path: string;
  /** '' for the root, posix-style relative path for workspace packages. */
  relPath: string;
  name: string;
  missing: boolean;
  packageJson: { name?: string; scripts: Record<string, string> } | null;
  packageManager: PackageManager | null;
  /** File names only — env files are never opened. */
  envFiles: string[];
  workspaces: DetectedProject[];
  prismaSchema: string | null;
  dockerCompose: string | null;
  /** null when the folder is not a git repository. */
  git: GitInfo | null;
  buildOutput: 'dist' | 'build' | null;
  claude: ClaudeFiles;
}

export const DetectedProjectSchema: z.ZodType<DetectedProject> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    rootId: z.string().min(1),
    path: z.string().min(1),
    relPath: z.string(),
    name: z.string().min(1),
    missing: z.boolean(),
    packageJson: z
      .object({ name: z.string().optional(), scripts: z.record(z.string(), z.string()) })
      .nullable(),
    packageManager: z.enum(PACKAGE_MANAGERS).nullable(),
    envFiles: z.array(z.string()),
    workspaces: z.array(DetectedProjectSchema),
    prismaSchema: z.string().nullable(),
    dockerCompose: z.string().nullable(),
    git: z.object({ branch: z.string().nullable(), head: z.string().nullable() }).nullable(),
    buildOutput: z.enum(['dist', 'build']).nullable(),
    claude: z.object({
      claudeMd: z.boolean(),
      claudeLocalMd: z.boolean(),
      claudeDir: z.boolean(),
      mcpJson: z.boolean(),
    }),
  }),
);

export const ProjectSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  pinned: z.boolean(),
  tags: z.array(z.string()),
  detected: DetectedProjectSchema,
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const WORKSPACE_ID_SEPARATOR = '::';

export function workspaceId(rootId: string, relPath: string): string {
  return `${rootId}${WORKSPACE_ID_SEPARATOR}${relPath}`;
}

export function splitProjectId(id: string): { rootId: string; relPath: string } {
  const at = id.indexOf(WORKSPACE_ID_SEPARATOR);
  if (at === -1) return { rootId: id, relPath: '' };
  return { rootId: id.slice(0, at), relPath: id.slice(at + WORKSPACE_ID_SEPARATOR.length) };
}

export function findDetected(root: DetectedProject, id: string): DetectedProject | null {
  if (root.id === id) return root;
  return root.workspaces.find((w) => w.id === id) ?? null;
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `pnpm vitest run src/shared && pnpm typecheck`
Expected: all tests pass, with no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared
git commit -m "feat(shared): add error envelope, persisted schemas and detected-project types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Windows argument escaping

**Files:**
- Create: `src/main/platform/win32-escape.ts`
- Test: `src/main/platform/win32-escape.test.ts`

**Interfaces:**
- Produces:
  - `quoteWindowsArg(arg: string): string`: MSVCRT / `CommandLineToArgvW` quoting.
  - `escapeCmdArg(arg: string): string`: quote, then `^`-escape every cmd metacharacter.
  - `escapeCmdCommand(command: string): string`
  - `cmdInvocation(command: string, args: readonly string[]): { file: 'cmd.exe'; args: string[] }`: spawn this with `windowsVerbatimArguments: true`.
  - `escapeWtArg(arg: string): string`: `;` becomes `\;`.

**Background for the implementer:**
- On Windows, `code`, `npm` and `pnpm` are `.cmd` batch shims, and current Node refuses to spawn `.cmd` files without a shell. We run them as `cmd.exe /d /s /c "<line>"` and pass `windowsVerbatimArguments: true`, so Node doesn't add a second layer of quoting.
- Inside `<line>`, each argument is first quoted with the C runtime rules, then every cmd metacharacter is caret-escaped, including the quotes themselves. Escaping the quotes keeps cmd out of "quote mode", so it consumes every caret and hands the program exactly the quoted argument.
- This is the scheme `cross-spawn` uses (`lib/util/escape.js`).
- `%` is handled because `^%PATH^%` contains no valid variable name during cmd's percent-expansion phase.
- Windows Terminal (`wt.exe`) is spawned directly, without a shell. It splits its own command line into sub-commands on `;`, so a literal `;` must be written as `\;`.

- [ ] **Step 1: Write the failing tests**

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cmdInvocation, escapeCmdArg, escapeWtArg, quoteWindowsArg } from './win32-escape';

const TRICKY = [
  'C:\\Users\\me\\My Projects\\shop',
  'C:\\dev\\R&D\\app',
  'C:\\dev\\a^b\\app',
  'C:\\dev\\100%\\app',
  'C:\\dev\\%PATH%\\app',
  'C:\\dev\\a;b\\app',
  'C:\\dev\\trailing slash\\',
  'C:\\dev\\(x86) & [y]\\app',
];

describe('quoteWindowsArg', () => {
  it('always wraps in double quotes', () => {
    expect(quoteWindowsArg('C:\\a')).toBe('"C:\\a"');
    expect(quoteWindowsArg('')).toBe('""');
  });

  it('doubles trailing backslashes so the closing quote is not escaped', () => {
    expect(quoteWindowsArg('C:\\a b\\')).toBe('"C:\\a b\\\\"');
  });

  it('escapes embedded quotes and the backslashes before them', () => {
    expect(quoteWindowsArg('a"b')).toBe('"a\\"b"');
    expect(quoteWindowsArg('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it('leaves backslashes that are not before a quote alone', () => {
    expect(quoteWindowsArg('C:\\x\\y')).toBe('"C:\\x\\y"');
  });
});

describe('escapeCmdArg', () => {
  it('caret-escapes quotes, spaces and cmd metacharacters', () => {
    expect(escapeCmdArg('C:\\R&D')).toBe('^"C:\\R^&D^"');
    expect(escapeCmdArg('a b')).toBe('^"a^ b^"');
    expect(escapeCmdArg('a^b')).toBe('^"a^^b^"');
    expect(escapeCmdArg('100%')).toBe('^"100^%^"');
    expect(escapeCmdArg('a;b')).toBe('^"a^;b^"');
  });
});

describe('cmdInvocation', () => {
  it('builds a cmd.exe /d /s /c line with an outer quote pair', () => {
    expect(cmdInvocation('code', ['C:\\R&D'])).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '"code ^"C:\\R^&D^""'],
    });
  });
});

describe('escapeWtArg', () => {
  it('escapes ; so wt does not split sub-commands', () => {
    expect(escapeWtArg('C:\\dev\\a;b')).toBe('C:\\dev\\a\\;b');
    expect(escapeWtArg('C:\\plain')).toBe('C:\\plain');
  });
});

// Real round-trip through cmd.exe. Only meaningful on Windows.
describe.runIf(process.platform === 'win32')('cmd.exe round-trip', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'nestbox-shim-'));
    writeFileSync(join(dir, 'echo.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    // Same shape as VS Code's bin\code.cmd: forwards %* to node.
    writeFileSync(join(dir, 'echo-args.cmd'), '@node "%~dp0echo.js" %*\r\n');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function roundTrip(command: string, args: string[]): string[] {
    const inv = cmdInvocation(command, args);
    const r = spawnSync(inv.file, inv.args, { windowsVerbatimArguments: true, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as string[];
  }

  it('passes tricky paths unchanged to an .exe (node on PATH)', () => {
    for (const p of TRICKY) {
      expect(roundTrip('node', [join(dir, 'echo.js'), p])).toEqual([p]);
    }
  });

  it('passes tricky paths unchanged through a .cmd shim (like code.cmd)', () => {
    for (const p of TRICKY) {
      expect(roundTrip(join(dir, 'echo-args.cmd'), [p])).toEqual([p]);
    }
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/main/platform/win32-escape.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/main/platform/win32-escape.ts`**

```ts
// Escaping for Windows process launches. Mirrors cross-spawn's lib/util/escape.js.

/** Characters cmd.exe treats specially. Includes the quote so cmd never enters quote mode. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** Quote one argument with the MSVCRT / CommandLineToArgvW rules. Always quotes. */
export function quoteWindowsArg(arg: string): string {
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  return out + '\\'.repeat(backslashes * 2) + '"';
}

/** Escape one argument for a cmd.exe command line. */
export function escapeCmdArg(arg: string): string {
  return quoteWindowsArg(arg).replace(CMD_META, '^$1');
}

/** Escape the command (program) part of a cmd.exe command line. */
export function escapeCmdCommand(command: string): string {
  return command.replace(CMD_META, '^$1');
}

/** Arguments for spawning `command args...` through cmd.exe. Spawn with windowsVerbatimArguments: true. */
export function cmdInvocation(
  command: string,
  args: readonly string[],
): { file: 'cmd.exe'; args: string[] } {
  const line = [escapeCmdCommand(command), ...args.map(escapeCmdArg)].join(' ');
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`] };
}

/** Windows Terminal splits its command line on ';' — escape literal semicolons. */
export function escapeWtArg(arg: string): string {
  return arg.replace(/;/g, '\\;');
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run src/main/platform/win32-escape.test.ts`
Expected on Windows: all tests pass, including both round-trip tests. On macOS the round-trip block is skipped.

If a round-trip case fails, don't weaken the test. Use superpowers:systematic-debugging and compare against cross-spawn's `escape.js`.

- [ ] **Step 5: Commit**

```bash
git add src/main/platform/win32-escape.ts src/main/platform/win32-escape.test.ts
git commit -m "feat(platform): add cmd.exe and Windows Terminal argument escaping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Platform adapters (Windows implementation, macOS stub, selector)

**Files:**
- Create: `src/main/platform/adapter.ts`, `src/main/platform/paths.ts`, `src/main/platform/command-runner.ts`, `src/main/platform/win32.ts`, `src/main/platform/darwin.ts`, `src/main/platform/index.ts`
- Test: `src/main/platform/paths.test.ts`, `src/main/platform/win32.test.ts`, `src/main/platform/darwin.test.ts`

**Interfaces:**
- Consumes: `cmdInvocation` and `escapeWtArg` (Task 4); `NestboxError` and `PlatformId` (Task 3).
- Produces:
  - `PlatformAdapter`, with all of these members:
    - `id: PlatformId`
    - `listListeningPorts(): Promise<PortEntry[]>`
    - `killTree(pid: number): Promise<void>`
    - `spawnScript(opts: SpawnOpts): ChildProcess`
    - `openTerminal(cwd: string, command?: string): Promise<void>`
    - `openInEditor(path: string, line?: number): Promise<void>`
    - `resolveShellEnv(): Promise<NodeJS.ProcessEnv>`
    - `normalizePath(p: string): string`
    - `samePath(a: string, b: string): boolean`
    - `windowChrome(colors: OverlayColors): WindowChrome`
  - `CommandRunner`: `launch(file, args, opts?: { cwd?: string; verbatim?: boolean }): Promise<void>`.
  - `PlatformDeps`: `{ runner: CommandRunner; getEditorCommand(): string }`.
  - Factories: `createWin32Adapter(deps)`, `createDarwinAdapter(deps)`, `createPlatformAdapter(deps)`.
  - The real runner, `spawnRunner`.
  - `notImplemented(method: string): never`.

- [ ] **Step 1: Write `src/main/platform/adapter.ts`.** It holds types and one helper, so it has no test of its own.

```ts
import type { ChildProcess } from 'node:child_process';
import { NestboxError } from '@shared/errors';
import type { PlatformId } from '@shared/types';

export interface PortEntry {
  port: number;
  pid: number;
  processName: string;
  command: string | null;
}

export interface SpawnOpts {
  cwd: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export interface OverlayColors {
  color: string;
  symbolColor: string;
  height: number;
}

export interface WindowChrome {
  titleBarStyle: 'hidden' | 'hiddenInset';
  titleBarOverlay?: OverlayColors;
}

export interface CommandRunner {
  /** Starts a detached process and resolves once it has spawned. Rejects (e.g. ENOENT) if it cannot start. */
  launch(file: string, args: readonly string[], opts?: { cwd?: string; verbatim?: boolean }): Promise<void>;
}

export interface PlatformDeps {
  runner: CommandRunner;
  getEditorCommand(): string;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  listListeningPorts(): Promise<PortEntry[]>;
  killTree(pid: number): Promise<void>;
  spawnScript(opts: SpawnOpts): ChildProcess;
  openTerminal(cwd: string, command?: string): Promise<void>;
  openInEditor(path: string, line?: number): Promise<void>;
  resolveShellEnv(): Promise<NodeJS.ProcessEnv>;
  /** Comparison key only — never store, display or pass to a command. */
  normalizePath(p: string): string;
  samePath(a: string, b: string): boolean;
  windowChrome(colors: OverlayColors): WindowChrome;
}

export function notImplemented(method: string): never {
  throw new NestboxError('NOT_IMPLEMENTED', `${method} is not implemented on this platform yet`);
}
```

- [ ] **Step 2: Write the failing tests**

`src/main/platform/paths.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizePosixPath, normalizeWin32Path } from './paths';

describe('normalizeWin32Path', () => {
  it('lower-cases and strips trailing separators', () => {
    expect(normalizeWin32Path('C:\\Dev\\Shop\\')).toBe('c:\\dev\\shop');
    expect(normalizeWin32Path('c:/dev/shop')).toBe('c:\\dev\\shop');
  });

  it('keeps a drive root intact', () => {
    expect(normalizeWin32Path('D:\\')).toBe('d:\\');
  });

  it('resolves dot segments', () => {
    expect(normalizeWin32Path('C:\\Dev\\x\\..\\Shop')).toBe('c:\\dev\\shop');
  });
});

describe('normalizePosixPath', () => {
  it('keeps case and strips trailing slash', () => {
    expect(normalizePosixPath('/Users/Me/Shop/')).toBe('/Users/Me/Shop');
    expect(normalizePosixPath('/')).toBe('/');
  });
});
```

`src/main/platform/win32.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { CommandRunner } from './adapter';
import { createWin32Adapter } from './win32';

interface Call {
  file: string;
  args: readonly string[];
  opts: { cwd?: string; verbatim?: boolean } | undefined;
}

function fakeRunner(failFiles: string[] = []): CommandRunner & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    launch: vi.fn(async (file: string, args: readonly string[], opts?: { cwd?: string; verbatim?: boolean }) => {
      calls.push({ file, args, opts });
      if (failFiles.includes(file)) {
        throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' });
      }
    }),
  };
}

const PATHS = {
  spaces: 'C:\\Users\\me\\My Projects\\shop',
  amp: 'C:\\dev\\R&D\\app',
  caret: 'C:\\dev\\a^b',
  percent: 'C:\\dev\\100%\\app',
  semicolon: 'C:\\dev\\a;b',
  trailing: 'C:\\dev\\trailing slash\\',
};

describe('win32 openInEditor', () => {
  it('runs the editor through cmd.exe with escaped arguments', async () => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openInEditor(PATHS.amp);
    expect(runner.calls[0]).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '"code ^"C:\\dev\\R^&D\\app^""'],
      opts: { verbatim: true },
    });
  });

  it.each(Object.entries(PATHS))('escapes %s paths', async (_name, path) => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openInEditor(path);
    const line = runner.calls[0]?.args[3] ?? '';
    expect(line.startsWith('"code ')).toBe(true);
    // the argument part: every metacharacter must be caret-escaped (no bare & ^ % ; space or quote)
    const argPart = line.slice('"code '.length, -1);
    expect(argPart.replace(/\^./g, '')).not.toMatch(/[&^%; "]/);
  });

  it('uses -g path:line when a line is given', async () => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openInEditor('C:\\a\\b.ts', 12);
    expect(runner.calls[0]?.args[3]).toBe('"code ^"-g^" ^"C:\\a\\b.ts:12^""');
  });

  it('reports a NOT_FOUND error when the editor cannot start', async () => {
    const runner = fakeRunner(['cmd.exe']);
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await expect(adapter.openInEditor('C:\\a')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('win32 openTerminal', () => {
  it.each(Object.entries(PATHS))('opens Windows Terminal with an escaped -d for %s paths', async (_n, path) => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openTerminal(path);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toEqual({
      file: 'wt.exe',
      args: ['-d', path.replace(/;/g, '\\;')],
      opts: undefined,
    });
  });

  it('runs a command in the new tab via cmd /k, escaping ;', async () => {
    const runner = fakeRunner();
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openTerminal('C:\\a', 'echo one; echo two');
    expect(runner.calls[0]?.args).toEqual(['-d', 'C:\\a', 'cmd.exe', '/k', 'echo one\\; echo two']);
  });

  it.each(Object.entries(PATHS))('falls back to cmd /K with the path as cwd for %s paths', async (_n, path) => {
    const runner = fakeRunner(['wt.exe']);
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await adapter.openTerminal(path);
    expect(runner.calls[1]).toEqual({ file: 'cmd.exe', args: ['/d', '/k'], opts: { cwd: path } });
    // the path must never be spliced into the cmd command line
    expect(runner.calls[1]?.args.join(' ')).not.toContain(path);
  });

  it('does not fall back on errors other than ENOENT', async () => {
    const runner: CommandRunner = { launch: vi.fn().mockRejectedValue(new Error('EACCES')) };
    const adapter = createWin32Adapter({ runner, getEditorCommand: () => 'code' });
    await expect(adapter.openTerminal('C:\\a')).rejects.toBeInstanceOf(NestboxError);
    expect(runner.launch).toHaveBeenCalledTimes(1);
  });
});

describe('win32 other members', () => {
  const adapter = createWin32Adapter({ runner: fakeRunner(), getEditorCommand: () => 'code' });

  it('compares paths case-insensitively and ignores trailing separators', () => {
    expect(adapter.samePath('C:\\Dev\\Shop', 'c:\\dev\\shop\\')).toBe(true);
    expect(adapter.samePath('C:\\Dev\\Shop', 'C:\\Dev\\Shop2')).toBe(false);
  });

  it('uses a native title bar overlay', () => {
    expect(adapter.windowChrome({ color: 'a', symbolColor: 'b', height: 40 })).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: 'a', symbolColor: 'b', height: 40 },
    });
  });

  it('returns a copy of the inherited environment', async () => {
    const env = await adapter.resolveShellEnv();
    expect(env).toEqual(process.env);
    expect(env).not.toBe(process.env);
  });

  it('stubs M1/M2 members with NOT_IMPLEMENTED', async () => {
    await expect(adapter.listListeningPorts()).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(adapter.killTree(1)).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    expect(() => adapter.spawnScript({ cwd: 'C:\\', command: 'pnpm', args: [], env: {} })).toThrow(NestboxError);
  });
});
```

`src/main/platform/darwin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDarwinAdapter } from './darwin';

describe('darwin stub', () => {
  const adapter = createDarwinAdapter({ runner: { launch: async () => {} }, getEditorCommand: () => 'code' });

  it('compares paths case-sensitively', () => {
    expect(adapter.samePath('/Users/me/Shop/', '/Users/me/Shop')).toBe(true);
    expect(adapter.samePath('/Users/me/Shop', '/users/me/shop')).toBe(false);
  });

  it('uses an inset title bar', () => {
    expect(adapter.windowChrome({ color: 'a', symbolColor: 'b', height: 40 })).toEqual({ titleBarStyle: 'hiddenInset' });
  });

  it('throws NOT_IMPLEMENTED for OS actions', async () => {
    await expect(adapter.openInEditor('/a')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(adapter.openTerminal('/a')).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(adapter.resolveShellEnv()).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm vitest run src/main/platform`
Expected: the new test files fail with module-not-found errors; the Task 4 tests still pass.

- [ ] **Step 4: Implement `src/main/platform/paths.ts`**

```ts
import { posix, win32 } from 'node:path';

export function normalizeWin32Path(p: string): string {
  const resolved = win32.resolve(p);
  const trimmed = /^[a-zA-Z]:\\$/.test(resolved) ? resolved : resolved.replace(/[\\/]+$/, '');
  return trimmed.toLowerCase();
}

export function normalizePosixPath(p: string): string {
  const resolved = posix.resolve(p);
  return resolved === '/' ? resolved : resolved.replace(/\/+$/, '');
}
```

- [ ] **Step 5: Implement `src/main/platform/win32.ts`**

```ts
import { NestboxError } from '@shared/errors';
import { notImplemented, type PlatformAdapter, type PlatformDeps } from './adapter';
import { normalizeWin32Path } from './paths';
import { cmdInvocation, escapeWtArg } from './win32-escape';

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

export function createWin32Adapter(deps: PlatformDeps): PlatformAdapter {
  return {
    id: 'win32',

    listListeningPorts: async () => notImplemented('listListeningPorts'),
    killTree: async () => notImplemented('killTree'),
    spawnScript: () => notImplemented('spawnScript'),

    async openInEditor(path, line) {
      const editor = deps.getEditorCommand();
      const args = line === undefined ? [path] : ['-g', `${path}:${line}`];
      const inv = cmdInvocation(editor, args);
      try {
        await deps.runner.launch(inv.file, inv.args, { verbatim: true });
      } catch {
        throw new NestboxError('NOT_FOUND', `Could not start the editor command "${editor}"`);
      }
    },

    async openTerminal(cwd, command) {
      const wtArgs = ['-d', escapeWtArg(cwd)];
      if (command !== undefined) wtArgs.push('cmd.exe', '/k', escapeWtArg(command));
      try {
        await deps.runner.launch('wt.exe', wtArgs);
        return;
      } catch (error) {
        if (!isEnoent(error)) throw new NestboxError('INTERNAL', 'Could not start Windows Terminal');
      }
      // Fallback: plain console. The folder goes through the process cwd, never the command line.
      const args = command === undefined ? ['/d', '/k'] : ['/d', '/k', command];
      try {
        await deps.runner.launch('cmd.exe', args, { cwd });
      } catch {
        throw new NestboxError('INTERNAL', 'Could not open a terminal');
      }
    },

    resolveShellEnv: async () => ({ ...process.env }),

    normalizePath: normalizeWin32Path,
    samePath: (a, b) => normalizeWin32Path(a) === normalizeWin32Path(b),

    windowChrome: (colors) => ({ titleBarStyle: 'hidden', titleBarOverlay: colors }),
  };
}
```

When the fallback is given a `command`, `/k` receives it unescaped. That is deliberate: commands are built by Nestbox itself (for example `claude --continue` in M3), never from user paths, and the test for the semicolon case covers the wt path.

- [ ] **Step 6: Implement `src/main/platform/darwin.ts`**

```ts
import { notImplemented, type PlatformAdapter, type PlatformDeps } from './adapter';
import { normalizePosixPath } from './paths';

/** macOS stub until the v2 macOS phase. Only path comparison and window chrome are real. */
export function createDarwinAdapter(_deps: PlatformDeps): PlatformAdapter {
  return {
    id: 'darwin',
    listListeningPorts: async () => notImplemented('listListeningPorts'),
    killTree: async () => notImplemented('killTree'),
    spawnScript: () => notImplemented('spawnScript'),
    openTerminal: async () => notImplemented('openTerminal'),
    openInEditor: async () => notImplemented('openInEditor'),
    resolveShellEnv: async () => notImplemented('resolveShellEnv'),
    normalizePath: normalizePosixPath,
    samePath: (a, b) => normalizePosixPath(a) === normalizePosixPath(b),
    windowChrome: () => ({ titleBarStyle: 'hiddenInset' }),
  };
}
```

- [ ] **Step 7: Implement `src/main/platform/command-runner.ts`** (thin wrapper around `spawn`; it is exercised manually in Task 17)

```ts
import { spawn } from 'node:child_process';
import type { CommandRunner } from './adapter';

export const spawnRunner: CommandRunner = {
  launch(file, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(file, [...args], {
        cwd: opts.cwd,
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        windowsVerbatimArguments: opts.verbatim ?? false,
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  },
};
```

- [ ] **Step 8: Implement `src/main/platform/index.ts`.** This is the only `process.platform` read in the codebase.

```ts
import type { PlatformAdapter, PlatformDeps } from './adapter';
import { createDarwinAdapter } from './darwin';
import { createWin32Adapter } from './win32';

export type { PlatformAdapter } from './adapter';

export function createPlatformAdapter(deps: PlatformDeps): PlatformAdapter {
  return process.platform === 'win32' ? createWin32Adapter(deps) : createDarwinAdapter(deps);
}
```

- [ ] **Step 9: Run the tests and lint**

Run: `pnpm vitest run src/main/platform && pnpm lint && pnpm typecheck`
Expected: all tests pass, and lint is clean (`process.platform` is allowed in `src/main/platform/`).

- [ ] **Step 10: Commit**

```bash
git add src/main/platform
git commit -m "feat(platform): add PlatformAdapter with Windows editor/terminal and macOS stub

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Project detection: files, git and package manager

**Files:**
- Create: `src/main/detection/fs-utils.ts`, `src/main/detection/git-head.ts`, `src/main/detection/package-manager.ts`, `src/main/detection/detect-project.ts`, `src/main/detection/test-fixtures.ts`
- Create (stub so `detect-project.ts` compiles; Task 7 implements it): `src/main/detection/workspaces.ts`
- Test: `src/main/detection/git-head.test.ts`, `src/main/detection/package-manager.test.ts`, `src/main/detection/detect-project.test.ts`

**Interfaces:**
- Consumes: `DetectedProject`, `GitInfo`, `PackageManager` and `workspaceId` (Task 3); `isRecord`.
- Produces:
  - `readGitInfo(dir: string): Promise<GitInfo | null>`
  - `detectPackageManager(fileNames: ReadonlySet<string>): PackageManager | null`
  - `isDirectory(p): Promise<boolean>` and `isFile(p): Promise<boolean>`
  - `interface DetectInput { id: string; path: string; name?: string }`
  - `interface DetectOptions { onWarning?: (file: string, reason: DetectWarning) => void }`, where `type DetectWarning = 'unreadable' | 'invalid-json' | 'not-an-object' | 'invalid-yaml'`
  - `detectProject(input: DetectInput, options?: DetectOptions): Promise<DetectedProject>`
  - Test helper: `makeTree(entries: Record<string, string | null>): Promise<string>` (`null` means a directory) and `removeTree(dir)`.

- [ ] **Step 1: Write `src/main/detection/test-fixtures.ts`**

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Creates a temp folder tree. Keys are posix-style relative paths; null creates a directory. */
export async function makeTree(entries: Record<string, string | null>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'nestbox-detect-'));
  for (const [rel, content] of Object.entries(entries)) {
    const target = join(root, ...rel.split('/'));
    if (content === null) {
      await mkdir(target, { recursive: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, 'utf8');
    }
  }
  return root;
}

export async function removeTree(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Write the failing tests**

`src/main/detection/git-head.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { readGitInfo } from './git-head';
import { makeTree, removeTree } from './test-fixtures';

const SHA = 'a8f912c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6';
let dir = '';
afterEach(async () => removeTree(dir));

describe('readGitInfo', () => {
  it('returns null when there is no .git', async () => {
    dir = await makeTree({ 'package.json': '{}' });
    expect(await readGitInfo(dir)).toBeNull();
  });

  it('reads the branch from .git/HEAD', async () => {
    dir = await makeTree({ '.git/HEAD': 'ref: refs/heads/feature/mcp-integration\n' });
    expect(await readGitInfo(dir)).toEqual({ branch: 'feature/mcp-integration', head: null });
  });

  it('reports a detached HEAD as a short hash', async () => {
    dir = await makeTree({ '.git/HEAD': `${SHA}\n` });
    expect(await readGitInfo(dir)).toEqual({ branch: null, head: 'a8f912c' });
  });

  it('follows a worktree .git file to its gitdir', async () => {
    dir = await makeTree({
      'main/.git/worktrees/wt1/HEAD': 'ref: refs/heads/m0-skeleton\n',
      'wt1/.git': 'gitdir: ../main/.git/worktrees/wt1\n',
    });
    expect(await readGitInfo(`${dir}/wt1`)).toEqual({ branch: 'm0-skeleton', head: null });
  });

  it('returns unknown branch for an unreadable HEAD', async () => {
    dir = await makeTree({ '.git': null });
    expect(await readGitInfo(dir)).toEqual({ branch: null, head: null });
  });
});
```

`src/main/detection/package-manager.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { detectPackageManager } from './package-manager';

describe('detectPackageManager', () => {
  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
  ])('%s → %s', (file, pm) => {
    expect(detectPackageManager(new Set([file]))).toBe(pm);
  });

  it('prefers pnpm, then yarn, then npm when several lockfiles exist', () => {
    expect(detectPackageManager(new Set(['package-lock.json', 'pnpm-lock.yaml']))).toBe('pnpm');
    expect(detectPackageManager(new Set(['package-lock.json', 'yarn.lock']))).toBe('yarn');
  });

  it('returns null without a lockfile', () => {
    expect(detectPackageManager(new Set(['package.json']))).toBeNull();
  });
});
```

`src/main/detection/detect-project.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectProject } from './detect-project';
import { makeTree, removeTree } from './test-fixtures';

let dir = '';
afterEach(async () => removeTree(dir));

describe('detectProject', () => {
  it('marks a missing folder as missing', async () => {
    const d = await detectProject({ id: 'p1', path: join(__dirname, 'does-not-exist'), name: 'gone' });
    expect(d).toMatchObject({ id: 'p1', rootId: 'p1', missing: true, name: 'gone', workspaces: [], git: null });
  });

  it('reads name and string scripts from package.json', async () => {
    dir = await makeTree({
      'package.json': JSON.stringify({ name: 'shop', scripts: { dev: 'vite', build: 'vite build', bad: 5 } }),
    });
    const d = await detectProject({ id: 'p1', path: dir });
    expect(d.name).toBe('shop');
    expect(d.packageJson).toEqual({ name: 'shop', scripts: { dev: 'vite', build: 'vite build' } });
    expect(d.path).toBe(dir);
    expect(d.relPath).toBe('');
  });

  it('prefers the stored name, then package.json name, then folder name', async () => {
    dir = await makeTree({ 'package.json': JSON.stringify({ name: 'shop' }) });
    expect((await detectProject({ id: 'p', path: dir, name: 'My Shop' })).name).toBe('My Shop');
    const bare = await makeTree({ 'README.md': 'x' });
    try {
      expect((await detectProject({ id: 'p', path: bare })).name).toBe(bare.split(/[\\/]/).pop());
    } finally {
      await removeTree(bare);
    }
  });

  it('parses package.json with a UTF-8 BOM', async () => {
    dir = await makeTree({ 'package.json': '\uFEFF{"name":"bom"}' });
    expect((await detectProject({ id: 'p', path: dir })).packageJson?.name).toBe('bom');
  });

  it('survives invalid package.json and warns with the file name only', async () => {
    dir = await makeTree({ 'package.json': '{"name": "SECRET_TOKEN_123", oops' });
    const onWarning = vi.fn();
    const d = await detectProject({ id: 'p', path: dir }, { onWarning });
    expect(d.packageJson).toBeNull();
    expect(onWarning).toHaveBeenCalledWith('package.json', 'invalid-json');
    expect(JSON.stringify(onWarning.mock.calls)).not.toContain('SECRET_TOKEN_123');
  });

  it('warns when package.json is not an object', async () => {
    dir = await makeTree({ 'package.json': '[1,2]' });
    const onWarning = vi.fn();
    expect((await detectProject({ id: 'p', path: dir }, { onWarning })).packageJson).toBeNull();
    expect(onWarning).toHaveBeenCalledWith('package.json', 'not-an-object');
  });

  it('lists .env* file names only, sorted, ignoring directories', async () => {
    dir = await makeTree({
      '.env': 'DATABASE_URL=postgres://user:SECRET@host/db',
      '.env.example': 'DATABASE_URL=',
      '.env.local': 'X=1',
      '.envrc.d': null,
      'env.txt': 'x',
    });
    const d = await detectProject({ id: 'p', path: dir });
    expect(d.envFiles).toEqual(['.env', '.env.example', '.env.local']);
    expect(JSON.stringify(d)).not.toContain('SECRET');
  });

  it('detects package manager, prisma, compose, build output and Claude files', async () => {
    dir = await makeTree({
      'package.json': '{}',
      'pnpm-lock.yaml': '',
      'prisma/schema.prisma': 'datasource db {}',
      'compose.yaml': 'services: {}',
      dist: null,
      'CLAUDE.md': '# hi',
      '.claude': null,
      '.mcp.json': '{}',
    });
    const d = await detectProject({ id: 'p', path: dir });
    expect(d.packageManager).toBe('pnpm');
    expect(d.prismaSchema).toBe('prisma/schema.prisma');
    expect(d.dockerCompose).toBe('compose.yaml');
    expect(d.buildOutput).toBe('dist');
    expect(d.claude).toEqual({ claudeMd: true, claudeLocalMd: false, claudeDir: true, mcpJson: true });
  });

  it('detects a multi-file prisma schema folder and docker-compose.yml', async () => {
    dir = await makeTree({ 'prisma/schema': null, 'docker-compose.yml': '', build: null });
    const d = await detectProject({ id: 'p', path: dir });
    expect(d.prismaSchema).toBe('prisma/schema');
    expect(d.dockerCompose).toBe('docker-compose.yml');
    expect(d.buildOutput).toBe('build');
  });

  it('includes git info', async () => {
    dir = await makeTree({ '.git/HEAD': 'ref: refs/heads/main\n' });
    expect((await detectProject({ id: 'p', path: dir })).git).toEqual({ branch: 'main', head: null });
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm vitest run src/main/detection`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `src/main/detection/fs-utils.ts`**

```ts
import { stat } from 'node:fs/promises';
import type { Stats } from 'node:fs';

export async function statOrNull(p: string): Promise<Stats | null> {
  try {
    return await stat(p);
  } catch {
    return null;
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  return (await statOrNull(p))?.isDirectory() ?? false;
}

export async function isFile(p: string): Promise<boolean> {
  return (await statOrNull(p))?.isFile() ?? false;
}
```

- [ ] **Step 5: Implement `src/main/detection/git-head.ts`.** It reads only `HEAD`.

```ts
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { GitInfo } from '@shared/detected';
import { statOrNull } from './fs-utils';

const UNKNOWN: GitInfo = { branch: null, head: null };

export async function readGitInfo(dir: string): Promise<GitInfo | null> {
  const dotGit = join(dir, '.git');
  const st = await statOrNull(dotGit);
  if (!st) return null;

  let gitDir = dotGit;
  if (st.isFile()) {
    const pointer = await readFile(dotGit, 'utf8').catch(() => '');
    const target = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
    if (!target) return UNKNOWN;
    gitDir = resolve(dir, target);
  }

  const head = (await readFile(join(gitDir, 'HEAD'), 'utf8').catch(() => null))?.trim();
  if (!head) return UNKNOWN;

  const branch = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  if (branch) return { branch, head: null };
  if (/^[0-9a-f]{40,64}$/i.test(head)) return { branch: null, head: head.slice(0, 7) };
  return UNKNOWN;
}
```

- [ ] **Step 6: Implement `src/main/detection/package-manager.ts`**

```ts
import type { PackageManager } from '@shared/detected';

const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
];

export function detectPackageManager(fileNames: ReadonlySet<string>): PackageManager | null {
  return LOCKFILES.find(([file]) => fileNames.has(file))?.[1] ?? null;
}
```

- [ ] **Step 7: Create the stub `src/main/detection/workspaces.ts`** (Task 7 replaces it with the real implementation)

```ts
import type { DetectOptions } from './detect-project';

export async function findWorkspaceDirs(
  _root: string,
  _packageJson: Record<string, unknown> | null,
  _options: DetectOptions = {},
): Promise<string[]> {
  return [];
}
```

- [ ] **Step 8: Implement `src/main/detection/detect-project.ts`**

```ts
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { type DetectedProject, type PackageManager, workspaceId } from '@shared/detected';
import { isRecord } from '@shared/is-record';
import { isDirectory, isFile } from './fs-utils';
import { readGitInfo } from './git-head';
import { detectPackageManager } from './package-manager';
import { findWorkspaceDirs } from './workspaces';

export type DetectWarning = 'unreadable' | 'invalid-json' | 'not-an-object' | 'invalid-yaml';

export interface DetectInput {
  id: string;
  path: string;
  /** Stored display name; wins over package.json name. */
  name?: string;
}

export interface DetectOptions {
  /** Called with a project-relative file name and a reason. Never receives file contents. */
  onWarning?: (file: string, reason: DetectWarning) => void;
}

interface DirTarget {
  id: string;
  rootId: string;
  path: string;
  relPath: string;
  name?: string;
  inheritedPackageManager?: PackageManager;
}

interface PackageJsonRead {
  raw: Record<string, unknown>;
  info: { name?: string; scripts: Record<string, string> };
}

const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

function label(target: DirTarget, file: string): string {
  return target.relPath ? `${target.relPath}/${file}` : file;
}

async function readPackageJson(
  file: string,
  fileLabel: string,
  options: DetectOptions,
): Promise<PackageJsonRead | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    options.onWarning?.(fileLabel, 'unreadable');
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    options.onWarning?.(fileLabel, 'invalid-json');
    return null;
  }
  if (!isRecord(raw)) {
    options.onWarning?.(fileLabel, 'not-an-object');
    return null;
  }
  const scripts: Record<string, string> = {};
  if (isRecord(raw['scripts'])) {
    for (const [key, value] of Object.entries(raw['scripts'])) {
      if (typeof value === 'string') scripts[key] = value;
    }
  }
  const name = typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'] : undefined;
  return { raw, info: name === undefined ? { scripts } : { name, scripts } };
}

async function detectPrisma(dir: string): Promise<string | null> {
  if (await isFile(join(dir, 'prisma', 'schema.prisma'))) return 'prisma/schema.prisma';
  if (await isDirectory(join(dir, 'prisma', 'schema'))) return 'prisma/schema';
  return null;
}

function missingProject(target: DirTarget): DetectedProject {
  return {
    id: target.id,
    rootId: target.rootId,
    path: target.path,
    relPath: target.relPath,
    name: target.name ?? basename(target.path),
    missing: true,
    packageJson: null,
    packageManager: null,
    envFiles: [],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null,
    git: null,
    buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
  };
}

async function detectDir(
  target: DirTarget,
  options: DetectOptions,
): Promise<{ detected: DetectedProject; rawPackageJson: Record<string, unknown> | null }> {
  if (!(await isDirectory(target.path))) {
    return { detected: missingProject(target), rawPackageJson: null };
  }
  const entries: Dirent[] = await readdir(target.path, { withFileTypes: true }).catch(() => []);
  const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const dirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));

  const pkg = files.has('package.json')
    ? await readPackageJson(join(target.path, 'package.json'), label(target, 'package.json'), options)
    : null;

  const detected: DetectedProject = {
    id: target.id,
    rootId: target.rootId,
    path: target.path,
    relPath: target.relPath,
    name: target.name ?? pkg?.info.name ?? basename(target.path),
    missing: false,
    packageJson: pkg?.info ?? null,
    packageManager: target.inheritedPackageManager ?? detectPackageManager(files),
    envFiles: [...files].filter((n) => n.startsWith('.env')).sort(),
    workspaces: [],
    prismaSchema: await detectPrisma(target.path),
    dockerCompose: COMPOSE_FILES.find((f) => files.has(f)) ?? null,
    git: await readGitInfo(target.path),
    buildOutput: dirs.has('dist') ? 'dist' : dirs.has('build') ? 'build' : null,
    claude: {
      claudeMd: files.has('CLAUDE.md'),
      claudeLocalMd: files.has('CLAUDE.local.md'),
      claudeDir: dirs.has('.claude'),
      mcpJson: files.has('.mcp.json'),
    },
  };
  return { detected, rawPackageJson: pkg?.raw ?? null };
}

export async function detectProject(
  input: DetectInput,
  options: DetectOptions = {},
): Promise<DetectedProject> {
  const { detected: root, rawPackageJson } = await detectDir(
    { id: input.id, rootId: input.id, path: input.path, relPath: '', ...(input.name ? { name: input.name } : {}) },
    options,
  );
  if (root.missing) return root;

  const relDirs = await findWorkspaceDirs(input.path, rawPackageJson, options);
  const workspaces = await Promise.all(
    relDirs.map(async (rel) => {
      const { detected } = await detectDir(
        {
          id: workspaceId(input.id, rel),
          rootId: input.id,
          path: join(input.path, ...rel.split('/')),
          relPath: rel,
          ...(root.packageManager ? { inheritedPackageManager: root.packageManager } : {}),
        },
        options,
      );
      return detected;
    }),
  );
  return { ...root, workspaces };
}
```

- [ ] **Step 9: Run the tests and confirm they pass**

Run: `pnpm vitest run src/main/detection && pnpm typecheck`
Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/main/detection
git commit -m "feat(detection): detect package.json, lockfile, env files, git, prisma, compose and Claude files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Project detection: workspaces

**Files:**
- Modify: `src/main/detection/workspaces.ts` (replace the stub)
- Test: `src/main/detection/workspaces.test.ts`; append to `src/main/detection/detect-project.test.ts`

**Interfaces:**
- Consumes: `DetectOptions`/`DetectWarning` (Task 6), `isRecord`.
- Produces: `findWorkspaceDirs(root: string, packageJson: Record<string, unknown> | null, options?: DetectOptions): Promise<string[]>`. It returns sorted, unique, posix-style relative directories, each of which contains a `package.json`.

- [ ] **Step 1: Write the failing tests**

`src/main/detection/workspaces.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTree, removeTree } from './test-fixtures';
import { findWorkspaceDirs } from './workspaces';

let dir = '';
afterEach(async () => removeTree(dir));

const PKG = '{"name":"x"}';

describe('findWorkspaceDirs', () => {
  it('returns [] when no workspaces are declared', async () => {
    dir = await makeTree({ 'package.json': PKG });
    expect(await findWorkspaceDirs(dir, {})).toEqual([]);
  });

  it('reads pnpm-workspace.yaml globs and negations', async () => {
    dir = await makeTree({
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - 'apps/*'\n  - '!packages/ignored'\n",
      'packages/api/package.json': PKG,
      'packages/ignored/package.json': PKG,
      'packages/no-manifest/README.md': 'x',
      'apps/web/package.json': PKG,
    });
    expect(await findWorkspaceDirs(dir, {})).toEqual(['apps/web', 'packages/api']);
  });

  it('reads package.json workspaces as an array or { packages }', async () => {
    dir = await makeTree({ 'packages/a/package.json': PKG, 'packages/b/package.json': PKG });
    expect(await findWorkspaceDirs(dir, { workspaces: ['packages/*'] })).toEqual(['packages/a', 'packages/b']);
    expect(await findWorkspaceDirs(dir, { workspaces: { packages: ['packages/a'] } })).toEqual(['packages/a']);
  });

  it('never returns node_modules packages, duplicates or the root', async () => {
    dir = await makeTree({
      'package.json': PKG,
      'packages/a/package.json': PKG,
      'packages/a/node_modules/dep/package.json': PKG,
      'node_modules/other/package.json': PKG,
    });
    const result = await findWorkspaceDirs(dir, { workspaces: ['packages/**', 'packages/*', './packages/a/', '.'] });
    expect(result).toEqual(['packages/a']);
  });

  it('survives invalid YAML and warns with the file name only', async () => {
    dir = await makeTree({ 'pnpm-workspace.yaml': 'packages: [\n  - SECRET' });
    const onWarning = vi.fn();
    expect(await findWorkspaceDirs(dir, null, { onWarning })).toEqual([]);
    expect(onWarning).toHaveBeenCalledWith('pnpm-workspace.yaml', 'invalid-yaml');
    expect(JSON.stringify(onWarning.mock.calls)).not.toContain('SECRET');
  });

  it('ignores non-string patterns', async () => {
    dir = await makeTree({ 'packages/a/package.json': PKG });
    expect(await findWorkspaceDirs(dir, { workspaces: ['packages/*', 42, null] })).toEqual(['packages/a']);
  });
});
```

Append to `src/main/detection/detect-project.test.ts`:

```ts
describe('detectProject workspaces', () => {
  it('nests workspace packages with derived ids and the root package manager', async () => {
    dir = await makeTree({
      'package.json': JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }),
      'pnpm-lock.yaml': '',
      'packages/api/package.json': JSON.stringify({ name: '@mono/api', scripts: { dev: 'tsx watch' } }),
      'packages/api/.env.example': 'PORT=',
      'packages/web/package.json': JSON.stringify({ name: '@mono/web' }),
    });
    const d = await detectProject({ id: 'root', path: dir });
    expect(d.workspaces.map((w) => [w.id, w.relPath, w.name, w.packageManager])).toEqual([
      ['root::packages/api', 'packages/api', '@mono/api', 'pnpm'],
      ['root::packages/web', 'packages/web', '@mono/web', 'pnpm'],
    ]);
    expect(d.workspaces[0]?.envFiles).toEqual(['.env.example']);
    expect(d.workspaces[0]?.workspaces).toEqual([]);
    expect(d.workspaces[0]?.rootId).toBe('root');
  });

  it('labels warnings from workspace packages with their relative path', async () => {
    dir = await makeTree({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'packages/bad/package.json': '{oops',
    });
    const onWarning = vi.fn();
    await detectProject({ id: 'root', path: dir }, { onWarning });
    expect(onWarning).toHaveBeenCalledWith('packages/bad/package.json', 'invalid-json');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/main/detection`
Expected: the new tests fail, because the stub returns `[]`.

- [ ] **Step 3: Implement `src/main/detection/workspaces.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { glob } from 'tinyglobby';
import { parse as parseYaml } from 'yaml';
import { isRecord } from '@shared/is-record';
import type { DetectOptions } from './detect-project';

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function pnpmPatterns(root: string, options: DetectOptions): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
  } catch {
    return [];
  }
  try {
    const doc: unknown = parseYaml(text);
    return isRecord(doc) ? strings(doc['packages']) : [];
  } catch {
    options.onWarning?.('pnpm-workspace.yaml', 'invalid-yaml');
    return [];
  }
}

function packageJsonPatterns(pkg: Record<string, unknown> | null): string[] {
  if (!pkg) return [];
  const ws = pkg['workspaces'];
  if (Array.isArray(ws)) return strings(ws);
  if (isRecord(ws)) return strings(ws['packages']);
  return [];
}

function clean(pattern: string): string {
  return pattern.trim().replace(/^\.\//, '').replace(/\/+$/, '');
}

export async function findWorkspaceDirs(
  root: string,
  packageJson: Record<string, unknown> | null,
  options: DetectOptions = {},
): Promise<string[]> {
  const patterns = [...(await pnpmPatterns(root, options)), ...packageJsonPatterns(packageJson)];
  if (patterns.length === 0) return [];

  const include = patterns.filter((p) => !p.startsWith('!')).map(clean).filter((p) => p && p !== '.');
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => clean(p.slice(1)));
  if (include.length === 0) return [];

  const manifests = await glob(
    include.map((p) => `${p}/package.json`),
    {
      cwd: root,
      ignore: ['**/node_modules/**', ...exclude.map((p) => `${p}/package.json`)],
      onlyFiles: true,
    },
  );
  const dirs = new Set(manifests.map((file) => posix.dirname(file.replace(/\\/g, '/'))));
  dirs.delete('.');
  return [...dirs].sort();
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run src/main/detection && pnpm typecheck && pnpm lint`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/detection
git commit -m "feat(detection): expand pnpm and package.json workspaces into sub-projects

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Persistent store: migrations, validation and corruption recovery

**Files:**
- Create: `src/main/logger.ts`, `src/main/store/backend.ts`, `src/main/store/migrations.ts`, `src/main/store/store-service.ts`, `src/main/store/electron-store-backend.ts`
- Test: `src/main/logger.test.ts`, `src/main/store/migrations.test.ts`, `src/main/store/store-service.test.ts`

**Interfaces:**
- Consumes: `StoreDataSchema`, `defaultStoreData`, `CURRENT_SCHEMA_VERSION`, `Project` and `AppSettings` (Task 3); `isRecord`.
- Produces:
  - **Logger:**
    - `type LogFields = Record<string, string | number | boolean | null>`
    - `interface Logger { info; warn; error }`, each `(message: string, fields?: LogFields) => void`
    - `createConsoleLogger(): Logger`
    - `createMemoryLogger(): Logger & { entries: LogEntry[] }`
  - **Backends:**
    - `interface StoreBackend { read(): unknown; write(data: StoreData): void; backupCorrupt(): string | null }`
    - `createMemoryBackend(initial?: unknown): StoreBackend & { data: unknown; backups: number }`
  - **Migrations:** `type Migration`, `MIGRATIONS`, `class MigrationError`, `migrate(raw: unknown, target: number, table?): unknown`.
  - **`class StoreService`:**
    - `constructor(backend: StoreBackend, logger: Logger, migrations?: Readonly<Record<number, Migration>>)`
    - `getProjects(): readonly Project[]`
    - `getSettings(): AppSettings`
    - `updateProjects(fn: (projects: Project[]) => Project[]): void`
  - **Electron backend:** `createElectronStoreBackend(userDataDir: string): StoreBackend`.

- [ ] **Step 1: Write the failing tests**

`src/main/logger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createMemoryLogger } from './logger';

describe('memory logger', () => {
  it('records level, message and primitive fields', () => {
    const log = createMemoryLogger();
    log.warn('store reset', { reason: 'invalid', backup: null });
    expect(log.entries).toEqual([{ level: 'warn', message: 'store reset', fields: { reason: 'invalid', backup: null } }]);
  });
});
```

`src/main/store/migrations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrate, MigrationError } from './migrations';

describe('migrate', () => {
  it('returns data unchanged when already at the target version', () => {
    const raw = { schemaVersion: 1, settings: {}, projects: [] };
    expect(migrate(raw, 1, {})).toEqual(raw);
  });

  it('applies migrations step by step and bumps schemaVersion', () => {
    const table = {
      0: (d: Record<string, unknown>) => ({ ...d, settings: {} }),
      1: (d: Record<string, unknown>) => ({ ...d, projects: [] }),
    };
    expect(migrate({ schemaVersion: 0 }, 2, table)).toEqual({ schemaVersion: 2, settings: {}, projects: [] });
  });

  it.each([
    ['a non-object', [1, 2]],
    ['a missing version', { projects: [] }],
    ['a newer version', { schemaVersion: 9 }],
  ])('rejects %s', (_label, raw) => {
    expect(() => migrate(raw, 1, {})).toThrow(MigrationError);
  });

  it('rejects a gap in the migration table', () => {
    expect(() => migrate({ schemaVersion: 0 }, 2, { 0: (d) => d })).toThrow(/No migration from v1/);
  });
});
```

`src/main/store/store-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultStoreData } from '@shared/types';
import { createMemoryLogger } from '../logger';
import { createMemoryBackend } from './backend';
import { StoreService } from './store-service';

const project = { id: 'p1', name: 'shop', path: 'C:\\Dev\\Shop', tags: [], pinned: false, runGroups: [], envProfiles: [], toolSettings: {} };

describe('StoreService', () => {
  it('initialises an empty backend with defaults and writes them', () => {
    const backend = createMemoryBackend({});
    const store = new StoreService(backend, createMemoryLogger());
    expect(store.getProjects()).toEqual([]);
    expect(backend.data).toEqual(defaultStoreData());
  });

  it('loads valid data', () => {
    const backend = createMemoryBackend({ ...defaultStoreData(), projects: [project] });
    expect(new StoreService(backend, createMemoryLogger()).getProjects()).toEqual([project]);
  });

  it('runs migrations and persists the result', () => {
    const backend = createMemoryBackend({ schemaVersion: 0, projects: [project] });
    const store = new StoreService(backend, createMemoryLogger(), {
      0: (d) => ({ ...d, settings: {} }),
    });
    expect(store.getSettings().editorCommand).toBe('code');
    expect((backend.data as { schemaVersion: number }).schemaVersion).toBe(1);
  });

  it.each([
    ['unreadable JSON', 'throw'],
    ['schema-invalid data', { schemaVersion: 1, settings: {}, projects: [{ id: 5 }] }],
    ['a newer schema version', { schemaVersion: 7, settings: {}, projects: [] }],
    ['a missing schema version', { projects: [] }],
  ])('backs up and resets on %s', (_label, initial) => {
    const backend = createMemoryBackend(initial === 'throw' ? undefined : initial);
    if (initial === 'throw') backend.read = () => { throw new SyntaxError('Unexpected token'); };
    const logger = createMemoryLogger();
    const store = new StoreService(backend, logger);
    expect(store.getProjects()).toEqual([]);
    expect(backend.backups).toBe(1);
    expect(backend.data).toEqual(defaultStoreData());
    expect(logger.entries[0]).toMatchObject({ level: 'warn', message: 'Store reset to defaults' });
  });

  it('never logs stored values when resetting', () => {
    const backend = createMemoryBackend({ schemaVersion: 1, settings: { editorCommand: 'SECRET_CMD' }, projects: 'x' });
    const logger = createMemoryLogger();
    new StoreService(backend, logger);
    expect(JSON.stringify(logger.entries)).not.toContain('SECRET_CMD');
  });

  it('validates and persists project updates', () => {
    const backend = createMemoryBackend({});
    const store = new StoreService(backend, createMemoryLogger());
    store.updateProjects((ps) => [...ps, project]);
    expect(store.getProjects()).toEqual([project]);
    expect((backend.data as { projects: unknown[] }).projects).toHaveLength(1);
    expect(() => store.updateProjects((ps) => [...ps, { ...project, id: '' }])).toThrow();
    expect(store.getProjects()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/main/logger.test.ts src/main/store`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/main/logger.ts`**

```ts
/** Fields are primitives only, so whole objects (payloads, env, file contents) cannot be logged by accident. */
export type LogFields = Record<string, string | number | boolean | null>;
export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  fields: LogFields | undefined;
}

export function createConsoleLogger(): Logger {
  const write = (level: LogLevel) => (message: string, fields?: LogFields) => {
    const line = fields ? `${message} ${JSON.stringify(fields)}` : message;
    console[level](`[nestbox] ${line}`);
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}

export function createMemoryLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const write = (level: LogLevel) => (message: string, fields?: LogFields) => {
    entries.push({ level, message, fields });
  };
  return { entries, info: write('info'), warn: write('warn'), error: write('error') };
}
```

- [ ] **Step 4: Implement `src/main/store/backend.ts`**

```ts
import type { StoreData } from '@shared/types';

export interface StoreBackend {
  /** Raw persisted value. May throw (e.g. malformed JSON). */
  read(): unknown;
  write(data: StoreData): void;
  /** Moves the current file aside; returns the backup location or null if there was nothing to move. */
  backupCorrupt(): string | null;
}

export function createMemoryBackend(initial?: unknown): StoreBackend & { data: unknown; backups: number } {
  const backend = {
    data: initial,
    backups: 0,
    read(): unknown {
      return backend.data;
    },
    write(data: StoreData): void {
      backend.data = structuredClone(data);
    },
    backupCorrupt(): string | null {
      backend.backups++;
      backend.data = undefined;
      return `memory-backup-${backend.backups}`;
    },
  };
  return backend;
}
```

- [ ] **Step 5: Implement `src/main/store/migrations.ts`**

```ts
import { isRecord } from '@shared/is-record';

/** Transforms data from version N (its table key) to N + 1. schemaVersion is set by migrate(). */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** Real migrations, keyed by from-version. Empty until the first schema change (M1: trayIconTheme). */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export class MigrationError extends Error {
  override name = 'MigrationError';
}

export function migrate(
  raw: unknown,
  target: number,
  table: Readonly<Record<number, Migration>> = MIGRATIONS,
): unknown {
  if (!isRecord(raw)) throw new MigrationError('Store root is not an object');
  const version = raw['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new MigrationError('Store has no schemaVersion');
  }
  if (version > target) {
    throw new MigrationError(`Store schemaVersion ${version} is newer than supported ${target}`);
  }
  let data: Record<string, unknown> = raw;
  for (let v = version; v < target; v++) {
    const step = table[v];
    if (!step) throw new MigrationError(`No migration from v${v}`);
    data = { ...step(data), schemaVersion: v + 1 };
  }
  return data;
}
```

- [ ] **Step 6: Implement `src/main/store/store-service.ts`**

```ts
import { isRecord } from '@shared/is-record';
import {
  type AppSettings,
  CURRENT_SCHEMA_VERSION,
  defaultStoreData,
  type Project,
  type StoreData,
  StoreDataSchema,
} from '@shared/types';
import type { Logger } from '../logger';
import type { StoreBackend } from './backend';
import { MIGRATIONS, migrate, type Migration } from './migrations';

export class StoreService {
  private data: StoreData;

  constructor(
    private readonly backend: StoreBackend,
    private readonly logger: Logger,
    private readonly migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  ) {
    this.data = this.load();
  }

  getProjects(): readonly Project[] {
    return this.data.projects;
  }

  getSettings(): AppSettings {
    return this.data.settings;
  }

  /** Validates before persisting; on failure throws and leaves state untouched. */
  updateProjects(fn: (projects: Project[]) => Project[]): void {
    const next = StoreDataSchema.parse({ ...this.data, projects: fn([...this.data.projects]) });
    this.backend.write(next);
    this.data = next;
  }

  private load(): StoreData {
    let raw: unknown;
    try {
      raw = this.backend.read();
    } catch {
      return this.reset('unreadable');
    }
    if (raw === undefined || raw === null || (isRecord(raw) && Object.keys(raw).length === 0)) {
      const fresh = defaultStoreData();
      this.backend.write(fresh);
      return fresh;
    }
    let migrated: unknown;
    try {
      migrated = migrate(raw, CURRENT_SCHEMA_VERSION, this.migrations);
    } catch {
      return this.reset('migration-failed');
    }
    const parsed = StoreDataSchema.safeParse(migrated);
    if (!parsed.success) return this.reset('invalid');
    if (migrated !== raw) this.backend.write(parsed.data);
    return parsed.data;
  }

  private reset(reason: string): StoreData {
    const backup = this.backend.backupCorrupt();
    this.logger.warn('Store reset to defaults', { reason, backup });
    const fresh = defaultStoreData();
    this.backend.write(fresh);
    return fresh;
  }
}
```

- [ ] **Step 7: Implement `src/main/store/electron-store-backend.ts`.** It is a thin adapter around electron-store, verified by the manual run in Task 17.

```ts
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import Store from 'electron-store';
import type { StoreData } from '@shared/types';
import type { StoreBackend } from './backend';

const NAME = 'config';

export function createElectronStoreBackend(userDataDir: string): StoreBackend {
  let store: Store<Record<string, unknown>> | null = null;
  const open = (): Store<Record<string, unknown>> => {
    // Throws SyntaxError on malformed JSON; StoreService treats that as corruption.
    store ??= new Store<Record<string, unknown>>({
      name: NAME,
      cwd: userDataDir,
      clearInvalidConfig: false,
      accessPropertiesByDotNotation: false,
    });
    return store;
  };

  return {
    read: () => open().store,
    write: (data: StoreData) => {
      open().store = data as unknown as Record<string, unknown>;
    },
    backupCorrupt: () => {
      store = null;
      const file = join(userDataDir, `${NAME}.json`);
      if (!existsSync(file)) return null;
      const backup = join(userDataDir, `${NAME}.corrupt-${Date.now()}.json`);
      renameSync(file, backup);
      return backup;
    },
  };
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `pnpm vitest run src/main/logger.test.ts src/main/store && pnpm typecheck && pnpm lint`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/main/logger.ts src/main/logger.test.ts src/main/store
git commit -m "feat(store): add versioned, Zod-validated store with migrations and corruption recovery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Project service: add, remove, rename, pin, refresh, lookup

**Files:**
- Create: `src/main/projects/project-service.ts`
- Test: `src/main/projects/project-service.test.ts`

**Interfaces:**
- Consumes:
  - `StoreService` (Task 8)
  - `DetectInput` (Task 6)
  - From Task 3: `DetectedProject`, `ProjectSummary`, `splitProjectId`, `findDetected`, `ProjectSchema`, `NestboxError`
  - `createWin32Adapter(...).samePath` (Task 5), used in the tests
- Produces:
  - `interface ProjectServiceDeps`:
    - `store: StoreService`
    - `samePath(a: string, b: string): boolean`
    - `resolvePath(p: string): string`
    - `isDirectory(p: string): Promise<boolean>`
    - `detect(input: DetectInput): Promise<DetectedProject>`
    - `newId(): string`
    - `onChanged(): void`
  - `class ProjectService`:
    - `init(): Promise<void>`
    - `list(): Promise<ProjectSummary[]>`
    - `add(path: string): Promise<ProjectSummary>`
    - `remove(id: string): void`
    - `rename(id: string, name: string): ProjectSummary`
    - `setPinned(id: string, pinned: boolean): ProjectSummary`
    - `refresh(id: string): Promise<ProjectSummary>`
    - `getDetected(projectId: string): DetectedProject`: throws `NOT_FOUND`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import type { DetectInput } from '../detection/detect-project';
import { createMemoryLogger } from '../logger';
import { createWin32Adapter } from '../platform/win32';
import { createMemoryBackend } from '../store/backend';
import { StoreService } from '../store/store-service';
import { ProjectService } from './project-service';

const win32 = createWin32Adapter({ runner: { launch: async () => {} }, getEditorCommand: () => 'code' });

function fakeDetect(input: DetectInput): DetectedProject {
  const folder = input.path.split('\\').pop() ?? input.path;
  return {
    id: input.id,
    rootId: input.id,
    path: input.path,
    relPath: '',
    name: input.name ?? folder.toLowerCase(),
    missing: false,
    packageJson: null,
    packageManager: 'pnpm',
    envFiles: [],
    workspaces: [
      { ...emptyDetected(), id: `${input.id}::packages/api`, rootId: input.id, relPath: 'packages/api', name: 'api', path: `${input.path}\\packages\\api` },
    ],
    prismaSchema: null,
    dockerCompose: null,
    git: null,
    buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
  };
}

function emptyDetected(): DetectedProject {
  return {
    id: 'x', rootId: 'x', path: 'x', relPath: '', name: 'x', missing: false, packageJson: null,
    packageManager: null, envFiles: [], workspaces: [], prismaSchema: null, dockerCompose: null,
    git: null, buildOutput: null,
    claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
  };
}

function setup(initial?: unknown) {
  const backend = createMemoryBackend(initial ?? {});
  const store = new StoreService(backend, createMemoryLogger());
  let n = 0;
  const onChanged = vi.fn();
  const detect = vi.fn(async (input: DetectInput) => fakeDetect(input));
  const isDirectory = vi.fn(async () => true);
  const service = new ProjectService({
    store,
    samePath: win32.samePath,
    resolvePath: (p) => p,
    isDirectory,
    detect,
    newId: () => `id-${++n}`,
    onChanged,
  });
  return { service, store, backend, onChanged, detect, isDirectory };
}

describe('ProjectService.add', () => {
  it('stores the project with its original path casing and detected name', async () => {
    const { service, store, onChanged } = setup();
    const summary = await service.add('C:\\Dev\\Shop');
    expect(summary).toMatchObject({ id: 'id-1', name: 'shop', path: 'C:\\Dev\\Shop', pinned: false });
    expect(store.getProjects()[0]?.path).toBe('C:\\Dev\\Shop');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('rejects the same folder with different casing or a trailing separator', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    await expect(service.add('c:\\dev\\shop\\')).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'This folder is already added as "shop"',
    });
  });

  it('rejects a folder that does not exist', async () => {
    const { service, isDirectory } = setup();
    isDirectory.mockResolvedValueOnce(false);
    await expect(service.add('C:\\Nope')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('ProjectService lookups and edits', () => {
  it('lists projects with detection results', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    const [first] = await service.list();
    expect(first?.detected.workspaces[0]?.id).toBe('id-1::packages/api');
  });

  it('detects stored projects on init and passes the stored name', async () => {
    const { service, detect } = setup({
      schemaVersion: 1,
      settings: {},
      projects: [{ id: 'p1', name: 'My Shop', path: 'C:\\Dev\\Shop' }],
    });
    await service.init();
    expect(detect).toHaveBeenCalledWith({ id: 'p1', path: 'C:\\Dev\\Shop', name: 'My Shop' });
    expect(service.getDetected('p1').name).toBe('My Shop');
  });

  it('finds root and workspace projects by id', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    expect(service.getDetected('id-1').name).toBe('shop');
    expect(service.getDetected('id-1::packages/api').name).toBe('api');
    expect(() => service.getDetected('id-1::nope')).toThrow(NestboxError);
    expect(() => service.getDetected('missing')).toThrow(NestboxError);
  });

  it('renames, keeping the detected name in sync', async () => {
    const { service, store } = setup();
    await service.add('C:\\Dev\\Shop');
    const s = service.rename('id-1', 'Shop Backend');
    expect(s.name).toBe('Shop Backend');
    expect(s.detected.name).toBe('Shop Backend');
    expect(store.getProjects()[0]?.name).toBe('Shop Backend');
  });

  it('pins and unpins', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    expect(service.setPinned('id-1', true).pinned).toBe(true);
    expect(service.setPinned('id-1', false).pinned).toBe(false);
  });

  it('removes a project', async () => {
    const { service, store, onChanged } = setup();
    await service.add('C:\\Dev\\Shop');
    service.remove('id-1');
    expect(store.getProjects()).toEqual([]);
    expect(() => service.getDetected('id-1')).toThrow(NestboxError);
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('refuses to rename, pin or remove a workspace package', async () => {
    const { service } = setup();
    await service.add('C:\\Dev\\Shop');
    expect(() => service.rename('id-1::packages/api', 'x')).toThrow(/Workspace packages/);
    expect(() => service.remove('id-1::packages/api')).toThrow(/Workspace packages/);
  });

  it('throws NOT_FOUND for unknown ids', async () => {
    const { service } = setup();
    expect(() => service.remove('nope')).toThrow('Project not found');
    try {
      service.remove('nope');
    } catch (e) {
      expect(e).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('refresh re-detects the root of a workspace id', async () => {
    const { service, detect } = setup();
    await service.add('C:\\Dev\\Shop');
    detect.mockClear();
    const s = await service.refresh('id-1::packages/api');
    expect(detect).toHaveBeenCalledWith({ id: 'id-1', path: 'C:\\Dev\\Shop', name: 'shop' });
    expect(s.id).toBe('id-1');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/main/projects`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/main/projects/project-service.ts`**

```ts
import { type DetectedProject, findDetected, type ProjectSummary, splitProjectId } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { type Project, ProjectSchema } from '@shared/types';
import type { DetectInput } from '../detection/detect-project';
import type { StoreService } from '../store/store-service';

export interface ProjectServiceDeps {
  store: StoreService;
  samePath(a: string, b: string): boolean;
  /** Makes a picked path absolute without changing its casing (path.resolve in production). */
  resolvePath(p: string): string;
  isDirectory(p: string): Promise<boolean>;
  detect(input: DetectInput): Promise<DetectedProject>;
  newId(): string;
  onChanged(): void;
}

export class ProjectService {
  /** Detection results by root project id. In memory only — never persisted. */
  private readonly detected = new Map<string, DetectedProject>();

  constructor(private readonly deps: ProjectServiceDeps) {}

  async init(): Promise<void> {
    await Promise.all(this.deps.store.getProjects().map((p) => this.detectAndCache(p)));
  }

  async list(): Promise<ProjectSummary[]> {
    return Promise.all(
      this.deps.store
        .getProjects()
        .map(async (p) => this.toSummary(p, this.detected.get(p.id) ?? (await this.detectAndCache(p)))),
    );
  }

  async add(rawPath: string): Promise<ProjectSummary> {
    const path = this.deps.resolvePath(rawPath);
    if (!(await this.deps.isDirectory(path))) {
      throw new NestboxError('VALIDATION', 'The selected folder does not exist');
    }
    const existing = this.deps.store.getProjects().find((p) => this.deps.samePath(p.path, path));
    if (existing) {
      throw new NestboxError('CONFLICT', `This folder is already added as "${existing.name}"`);
    }
    const id = this.deps.newId();
    const detected = await this.deps.detect({ id, path });
    const project = ProjectSchema.parse({ id, name: detected.name, path });
    this.deps.store.updateProjects((ps) => [...ps, project]);
    this.detected.set(id, detected);
    this.deps.onChanged();
    return this.toSummary(project, detected);
  }

  remove(id: string): void {
    const project = this.requireRoot(id);
    this.deps.store.updateProjects((ps) => ps.filter((p) => p.id !== project.id));
    this.detected.delete(project.id);
    this.deps.onChanged();
  }

  rename(id: string, name: string): ProjectSummary {
    const project = this.requireRoot(id);
    this.deps.store.updateProjects((ps) => ps.map((p) => (p.id === project.id ? { ...p, name } : p)));
    const cached = this.detected.get(project.id);
    if (cached) this.detected.set(project.id, { ...cached, name });
    this.deps.onChanged();
    return this.summaryOf(project.id);
  }

  setPinned(id: string, pinned: boolean): ProjectSummary {
    const project = this.requireRoot(id);
    this.deps.store.updateProjects((ps) => ps.map((p) => (p.id === project.id ? { ...p, pinned } : p)));
    this.deps.onChanged();
    return this.summaryOf(project.id);
  }

  async refresh(id: string): Promise<ProjectSummary> {
    const project = this.requireRoot(splitProjectId(id).rootId);
    const detected = await this.detectAndCache(project);
    this.deps.onChanged();
    return this.toSummary(project, detected);
  }

  getDetected(projectId: string): DetectedProject {
    const root = this.detected.get(splitProjectId(projectId).rootId);
    const found = root ? findDetected(root, projectId) : null;
    if (!found) throw new NestboxError('NOT_FOUND', 'Project not found');
    return found;
  }

  private requireRoot(id: string): Project {
    if (splitProjectId(id).relPath !== '') {
      throw new NestboxError('VALIDATION', 'Workspace packages cannot be changed individually');
    }
    const project = this.deps.store.getProjects().find((p) => p.id === id);
    if (!project) throw new NestboxError('NOT_FOUND', 'Project not found');
    return project;
  }

  private summaryOf(id: string): ProjectSummary {
    const project = this.requireRoot(id);
    return this.toSummary(project, this.getDetected(id));
  }

  private async detectAndCache(project: Project): Promise<DetectedProject> {
    const detected = await this.deps.detect({ id: project.id, path: project.path, name: project.name });
    this.detected.set(project.id, detected);
    return detected;
  }

  private toSummary(project: Project, detected: DetectedProject): ProjectSummary {
    return {
      id: project.id,
      name: project.name,
      path: project.path,
      pinned: project.pinned,
      tags: project.tags,
      detected,
    };
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm vitest run src/main/projects && pnpm typecheck`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/projects
git commit -m "feat(projects): add project service with duplicate detection and workspace lookup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: IPC contract and validating router

**Files:**
- Create: `src/shared/ipc-names.ts`, `src/shared/tool.ts` (only the `ToolSummary` part is needed here; Task 11 adds the rest), `src/shared/channels.ts`, `src/main/ipc/router.ts`, `src/main/ipc/register.ts`
- Test: `src/shared/channels.test.ts`, `src/main/ipc/router.test.ts`, `src/main/ipc/register.test.ts`

**Interfaces:**
- Consumes: from Task 3, `AppInfoSchema`, `ProjectNameSchema`, `ProjectSummarySchema`, `NestboxError`, `ok`, `fail`, `describeIssues` and `IpcEnvelope`; `Logger` (Task 8).
- Produces:
  - **`ipc-names.ts`:** `INVOKE_CHANNELS`, `InvokeChannel`, `EVENT_CHANNELS = ['projects:changed', 'tools:event']`, `EventChannel`, `isInvokeChannel`, `isEventChannel`.
  - **`tool.ts`:** `ToolSummarySchema`, `ToolSummary`.
  - **`channels.ts`:** `channels` (schemas per channel), `ChannelInput<C>`, `ChannelOutput<C>`, `HandlerInput<C>`, `HandlerResult<C>`.
  - **`router.ts`:**
    - `type CoreHandlers = { [C in InvokeChannel]: (input: HandlerInput<C>) => Promise<HandlerResult<C>> }`
    - `type Dispatch = (channel: string, senderUrl: string, payload: unknown) => Promise<IpcEnvelope<unknown>>`
    - `createRouter(deps: { handlers: CoreHandlers; isTrustedSender(url: string): boolean; logger: Logger; now?: () => number }): Dispatch`
  - **`register.ts`:** `registerIpc(ipcMain: IpcMainLike, dispatch: Dispatch): void`.

- [ ] **Step 1: Write `src/shared/ipc-names.ts`.** It must not import zod, because the preload bundles it.

```ts
export const INVOKE_CHANNELS = [
  'app:getInfo',
  'dialog:pickFolder',
  'projects:list',
  'projects:add',
  'projects:remove',
  'projects:rename',
  'projects:setPinned',
  'projects:refresh',
  'projects:openInEditor',
  'projects:openTerminal',
  'tools:list',
  'tools:invoke',
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

export const EVENT_CHANNELS = ['projects:changed', 'tools:event'] as const;
export type EventChannel = (typeof EVENT_CHANNELS)[number];

export function isInvokeChannel(value: unknown): value is InvokeChannel {
  return typeof value === 'string' && (INVOKE_CHANNELS as readonly string[]).includes(value);
}

export function isEventChannel(value: unknown): value is EventChannel {
  return typeof value === 'string' && (EVENT_CHANNELS as readonly string[]).includes(value);
}
```

- [ ] **Step 2: Write `src/shared/tool.ts` (first part)**

```ts
import { z } from 'zod';

export const ToolSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** lucide icon name, e.g. 'info'. */
  icon: z.string().min(1),
});
export type ToolSummary = z.infer<typeof ToolSummarySchema>;
```

- [ ] **Step 3: Write the failing tests**

`src/shared/channels.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { channels } from './channels';
import { INVOKE_CHANNELS } from './ipc-names';

describe('channels', () => {
  it('defines a schema pair for every invoke channel and nothing else', () => {
    expect(Object.keys(channels).sort()).toEqual([...INVOKE_CHANNELS].sort());
  });

  it('rejects unknown keys on inputs', () => {
    expect(channels['projects:remove'].input.safeParse({ id: 'a', extra: 1 }).success).toBe(false);
  });

  it('trims and bounds names on rename', () => {
    expect(channels['projects:rename'].input.parse({ id: 'a', name: '  x  ' })).toEqual({ id: 'a', name: 'x' });
    expect(channels['projects:rename'].input.safeParse({ id: 'a', name: ' ' }).success).toBe(false);
  });

  it('accepts no payload for no-input channels', () => {
    expect(channels['projects:list'].input.safeParse(undefined).success).toBe(true);
  });
});
```

`src/main/ipc/router.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { ProjectSummary } from '@shared/detected';
import { createMemoryLogger } from '../logger';
import { type CoreHandlers, createRouter } from './router';

const TRUSTED = 'http://localhost:5173/';

function handlers(overrides: Partial<CoreHandlers> = {}): CoreHandlers {
  const unexpected = vi.fn(async () => {
    throw new Error('not expected in this test');
  });
  return {
    'app:getInfo': async () => ({ version: '0.0.0', platform: 'win32' }),
    'dialog:pickFolder': unexpected,
    'projects:list': async () => [],
    'projects:add': unexpected,
    'projects:remove': unexpected,
    'projects:rename': unexpected,
    'projects:setPinned': unexpected,
    'projects:refresh': unexpected,
    'projects:openInEditor': unexpected,
    'projects:openTerminal': unexpected,
    'tools:list': unexpected,
    'tools:invoke': unexpected,
    ...overrides,
  } as CoreHandlers;
}

function router(overrides: Partial<CoreHandlers> = {}) {
  const logger = createMemoryLogger();
  const dispatch = createRouter({
    handlers: handlers(overrides),
    isTrustedSender: (url) => url === TRUSTED,
    logger,
    now: () => 0,
  });
  return { dispatch, logger };
}

describe('router', () => {
  it('dispatches a valid call and wraps the result', async () => {
    const { dispatch } = router();
    expect(await dispatch('app:getInfo', TRUSTED, undefined)).toEqual({
      ok: true,
      data: { version: '0.0.0', platform: 'win32' },
    });
  });

  it('rejects untrusted senders before anything else', async () => {
    const { dispatch } = router();
    expect(await dispatch('projects:list', 'https://evil.example/', undefined)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rejects unknown channels', async () => {
    const { dispatch } = router();
    expect(await dispatch('projects:nuke', TRUSTED, undefined)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('rejects invalid input without echoing values', async () => {
    const setPinned = vi.fn();
    const { dispatch, logger } = router({ 'projects:setPinned': setPinned });
    const res = await dispatch('projects:setPinned', TRUSTED, { id: 'a', pinned: 'SUPER_SECRET' });
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(JSON.stringify(res)).not.toContain('SUPER_SECRET');
    expect(JSON.stringify(logger.entries)).not.toContain('SUPER_SECRET');
    expect(setPinned).not.toHaveBeenCalled();
  });

  it('rejects extra input keys', async () => {
    const { dispatch } = router();
    expect(await dispatch('projects:list', TRUSTED, { sneaky: true })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('passes parsed (trimmed) input to the handler', async () => {
    const rename = vi.fn(async () => summary());
    const { dispatch } = router({ 'projects:rename': rename });
    await dispatch('projects:rename', TRUSTED, { id: 'a', name: '  New  ' });
    expect(rename).toHaveBeenCalledWith({ id: 'a', name: 'New' });
  });

  it('maps NestboxError to its code and message', async () => {
    const { dispatch } = router({
      'projects:add': async () => {
        throw new NestboxError('CONFLICT', 'This folder is already added as "shop"');
      },
    });
    expect(await dispatch('projects:add', TRUSTED, { path: 'C:\\x' })).toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'This folder is already added as "shop"' },
    });
  });

  it('hides unexpected error messages', async () => {
    const { dispatch, logger } = router({
      'projects:list': async () => {
        throw new Error('boom DATABASE_URL=postgres://secret');
      },
    });
    const res = await dispatch('projects:list', TRUSTED, undefined);
    expect(res).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Unexpected error' } });
    expect(JSON.stringify(logger.entries)).not.toContain('secret');
  });

  it('rejects handler output that does not match the schema', async () => {
    const { dispatch } = router({ 'app:getInfo': async () => ({ version: 1 }) as never });
    expect(await dispatch('app:getInfo', TRUSTED, undefined)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    });
  });

  it('logs channel, duration and code only', async () => {
    const { dispatch, logger } = router();
    await dispatch('projects:list', TRUSTED, undefined);
    expect(logger.entries).toEqual([
      { level: 'info', message: 'ipc', fields: { channel: 'projects:list', ms: 0, code: 'OK' } },
    ]);
  });
});

function summary(): ProjectSummary {
  return {
    id: 'a', name: 'New', path: 'C:\\a', pinned: false, tags: [],
    detected: {
      id: 'a', rootId: 'a', path: 'C:\\a', relPath: '', name: 'New', missing: false, packageJson: null,
      packageManager: null, envFiles: [], workspaces: [], prismaSchema: null, dockerCompose: null,
      git: null, buildOutput: null,
      claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
    },
  };
}
```

`src/main/ipc/register.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { INVOKE_CHANNELS } from '@shared/ipc-names';
import { registerIpc } from './register';

describe('registerIpc', () => {
  it('registers every invoke channel and forwards the sender frame url', async () => {
    const registered = new Map<string, (event: unknown, payload: unknown) => unknown>();
    const ipcMain = { handle: vi.fn((ch: string, fn: (event: unknown, payload: unknown) => unknown) => registered.set(ch, fn)) };
    const dispatch = vi.fn(async () => ({ ok: true as const, data: 1 }));
    registerIpc(ipcMain, dispatch);
    expect([...registered.keys()].sort()).toEqual([...INVOKE_CHANNELS].sort());
    await registered.get('projects:list')?.({ senderFrame: { url: 'file:///app/index.html' } }, undefined);
    expect(dispatch).toHaveBeenCalledWith('projects:list', 'file:///app/index.html', undefined);
    await registered.get('projects:list')?.({ senderFrame: null }, undefined);
    expect(dispatch).toHaveBeenLastCalledWith('projects:list', '', undefined);
  });
});
```

- [ ] **Step 4: Run them and confirm they fail**

Run: `pnpm vitest run src/shared/channels.test.ts src/main/ipc`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement `src/shared/channels.ts`**

```ts
import { z } from 'zod';
import { ProjectSummarySchema } from './detected';
import type { InvokeChannel } from './ipc-names';
import { ToolSummarySchema } from './tool';
import { AppInfoSchema, ProjectNameSchema } from './types';

const NoInput = z.void();
const Id = z.string().min(1).max(512);
const IdInput = z.strictObject({ id: Id });

interface ChannelSpec {
  input: z.ZodType;
  output: z.ZodType;
}

export const channels = {
  'app:getInfo': { input: NoInput, output: AppInfoSchema },
  'dialog:pickFolder': { input: NoInput, output: z.string().nullable() },
  'projects:list': { input: NoInput, output: z.array(ProjectSummarySchema) },
  'projects:add': { input: z.strictObject({ path: z.string().min(1).max(4096) }), output: ProjectSummarySchema },
  'projects:remove': { input: IdInput, output: z.void() },
  'projects:rename': { input: z.strictObject({ id: Id, name: ProjectNameSchema }), output: ProjectSummarySchema },
  'projects:setPinned': { input: z.strictObject({ id: Id, pinned: z.boolean() }), output: ProjectSummarySchema },
  'projects:refresh': { input: IdInput, output: ProjectSummarySchema },
  'projects:openInEditor': { input: IdInput, output: z.void() },
  'projects:openTerminal': { input: IdInput, output: z.void() },
  'tools:list': { input: z.strictObject({ projectId: Id }), output: z.array(ToolSummarySchema) },
  'tools:invoke': {
    input: z.strictObject({
      toolId: z.string().min(1).max(100),
      projectId: Id,
      method: z.string().min(1).max(100),
      input: z.unknown(),
    }),
    // Validated against the tool's own contract by the tool host.
    output: z.unknown(),
  },
} as const satisfies Record<InvokeChannel, ChannelSpec>;

type Spec<C extends InvokeChannel> = (typeof channels)[C];
/** What the renderer passes. */
export type ChannelInput<C extends InvokeChannel> = z.input<Spec<C>['input']>;
/** What the renderer receives. */
export type ChannelOutput<C extends InvokeChannel> = z.output<Spec<C>['output']>;
/** What a main-process handler receives (after parsing). */
export type HandlerInput<C extends InvokeChannel> = z.output<Spec<C>['input']>;
/** What a main-process handler returns (before output validation). */
export type HandlerResult<C extends InvokeChannel> = z.input<Spec<C>['output']>;
```

- [ ] **Step 6: Implement `src/main/ipc/router.ts`**

```ts
import { type ChannelOutput, channels, type HandlerInput, type HandlerResult } from '@shared/channels';
import { describeIssues, type ErrorCode, fail, type IpcEnvelope, NestboxError, ok } from '@shared/errors';
import { type InvokeChannel, isInvokeChannel } from '@shared/ipc-names';
import type { Logger } from '../logger';

export type CoreHandlers = {
  [C in InvokeChannel]: (input: HandlerInput<C>) => Promise<HandlerResult<C>>;
};

export type Dispatch = (channel: string, senderUrl: string, payload: unknown) => Promise<IpcEnvelope<unknown>>;

export interface RouterDeps {
  handlers: CoreHandlers;
  isTrustedSender(url: string): boolean;
  logger: Logger;
  now?: () => number;
}

export function createRouter(deps: RouterDeps): Dispatch {
  const now = deps.now ?? (() => performance.now());

  async function run<C extends InvokeChannel>(channel: C, payload: unknown): Promise<IpcEnvelope<ChannelOutput<C>>> {
    const spec = channels[channel];
    const input = spec.input.safeParse(payload);
    if (!input.success) {
      return fail('VALIDATION', `Invalid input for ${channel}: ${describeIssues(input.error)}`);
    }
    const handler = deps.handlers[channel] as (i: unknown) => Promise<unknown>;
    let result: unknown;
    try {
      result = await handler(input.data);
    } catch (error) {
      if (error instanceof NestboxError) return fail(error.code, error.message);
      deps.logger.error('ipc handler threw', { channel, error: error instanceof Error ? error.name : 'unknown' });
      return fail('INTERNAL', 'Unexpected error');
    }
    const output = spec.output.safeParse(result);
    if (!output.success) {
      deps.logger.error('ipc handler returned invalid output', { channel });
      return fail('INTERNAL', `${channel} returned invalid output`);
    }
    return ok(output.data as ChannelOutput<C>);
  }

  return async (channel, senderUrl, payload) => {
    const started = now();
    let envelope: IpcEnvelope<unknown>;
    if (!deps.isTrustedSender(senderUrl)) {
      envelope = fail('FORBIDDEN', 'Untrusted sender');
    } else if (!isInvokeChannel(channel)) {
      envelope = fail('NOT_FOUND', 'Unknown channel');
    } else {
      envelope = await run(channel, payload);
    }
    const code: ErrorCode | 'OK' = envelope.ok ? 'OK' : envelope.error.code;
    deps.logger.info('ipc', { channel: isInvokeChannel(channel) ? channel : 'unknown', ms: Math.round(now() - started), code });
    return envelope;
  };
}
```

- [ ] **Step 7: Implement `src/main/ipc/register.ts`**

```ts
import { INVOKE_CHANNELS } from '@shared/ipc-names';
import type { Dispatch } from './router';

interface InvokeEventLike {
  senderFrame?: { url: string } | null;
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: InvokeEventLike, payload: unknown) => unknown): void;
}

export function registerIpc(ipcMain: IpcMainLike, dispatch: Dispatch): void {
  for (const channel of INVOKE_CHANNELS) {
    ipcMain.handle(channel, (event, payload) => dispatch(channel, event.senderFrame?.url ?? '', payload));
  }
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `pnpm vitest run src/shared src/main/ipc && pnpm typecheck && pnpm lint`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/shared src/main/ipc
git commit -m "feat(ipc): add shared channel schemas and a validating router

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Tool system and the Project info tool (main half)

**Files:**
- Modify: `src/shared/tool.ts` (append)
- Create: `src/shared/tools/project-info/contract.ts`, `src/shared/tools/index.ts`, `src/main/tools/types.ts`, `src/main/tools/shared-context.ts`, `src/main/tools/tool-host.ts`, `src/main/tools/project-info/index.ts`, `src/main/tools/index.ts`
- Test: `src/main/tools/shared-context.test.ts`, `src/main/tools/tool-host.test.ts`, `src/shared/tools/index.test.ts`

**Interfaces:**
- Consumes: from Task 3, `DetectedProject`, `DetectedProjectSchema`, `NestboxError` and `describeIssues`; `PlatformAdapter` (Task 5); `Logger` (Task 8); `ToolSummary` (Task 10).
- Produces:
  - **`shared/tool.ts`:** `ToolDefinition<S>`, `ToolMethod`, `ToolContract`, `defineContract`.
  - **`shared/tools/index.ts`:**
    - `toolContracts` and `toolDefinitions`
    - `ToolId`, `ToolMethodName<T>`, `ToolMethodInput<T, M>`, `ToolMethodOutput<T, M>`
  - **`shared/tools/project-info/contract.ts`:** `projectInfoDefinition`, `projectInfoContract`.
  - **`main/tools/types.ts`:** `ToolContext`, `ToolHandlers<C>`, `MainTool<S, C>`, `AnyMainTool`, `defineMainTool`.
  - **`main/tools/shared-context.ts`:** `SharedFacts`, `SharedContext`, `createSharedContext()`.
  - **`main/tools/tool-host.ts`:**
    - `ToolEventPayload`, `ToolHost`, `createToolHost(deps)`
    - `ToolHost` has: `list(projectId): ToolSummary[]`, `invoke(toolId, projectId, method, input): Promise<unknown>`, `disposeAll(): Promise<void>`
  - **`main/tools/index.ts`:** `mainTools`.

- [ ] **Step 1: Append to `src/shared/tool.ts`**

```ts
import type { DetectedProject } from './detected';

export interface ToolDefinition<S> {
  /** 'project-info', later 'scripts', 'ports', 'env', 'static', 'claude'. */
  id: string;
  name: string;
  /** lucide icon name. */
  icon: string;
  appliesTo(project: DetectedProject): boolean;
  settingsSchema: z.ZodType<S>;
}

export interface ToolMethod {
  input: z.ZodType;
  output: z.ZodType;
}

export type ToolContract = Record<string, ToolMethod>;

export function defineContract<C extends ToolContract>(contract: C): C {
  return contract;
}
```

Move the `import type { DetectedProject }` line to the top of the file next to the zod import. The file then contains `ToolSummarySchema`, `ToolSummary` and the declarations above.

- [ ] **Step 2: Write `src/shared/tools/project-info/contract.ts`**

```ts
import { z } from 'zod';
import { DetectedProjectSchema } from '../../detected';
import { defineContract, type ToolDefinition } from '../../tool';

const settingsSchema = z.strictObject({});

export const projectInfoDefinition: ToolDefinition<z.infer<typeof settingsSchema>> = {
  id: 'project-info',
  name: 'Project info',
  icon: 'info',
  appliesTo: () => true,
  settingsSchema,
};

export const projectInfoContract = defineContract({
  getFacts: { input: z.strictObject({}), output: DetectedProjectSchema },
});
```

- [ ] **Step 3: Write `src/shared/tools/index.ts`**

```ts
import type { z } from 'zod';
import type { ToolDefinition } from '../tool';
import { projectInfoContract, projectInfoDefinition } from './project-info/contract';

/** Tool registry, shared half. Adding a tool = one line here, one in main/tools, one in renderer/tools. */
export const toolContracts = {
  'project-info': projectInfoContract,
} as const;

export const toolDefinitions: readonly ToolDefinition<unknown>[] = [projectInfoDefinition];

export type ToolId = keyof typeof toolContracts;
export type ToolMethodName<T extends ToolId> = keyof (typeof toolContracts)[T] & string;
type MethodSpec<T extends ToolId, M extends ToolMethodName<T>> = (typeof toolContracts)[T][M] & {
  input: z.ZodType;
  output: z.ZodType;
};
export type ToolMethodInput<T extends ToolId, M extends ToolMethodName<T>> = z.input<MethodSpec<T, M>['input']>;
export type ToolMethodOutput<T extends ToolId, M extends ToolMethodName<T>> = z.output<MethodSpec<T, M>['output']>;
```

- [ ] **Step 4: Write `src/main/tools/types.ts`.** It holds types and one helper.

```ts
import type { z } from 'zod';
import type { DetectedProject } from '@shared/detected';
import type { ToolContract, ToolDefinition } from '@shared/tool';
import type { PlatformAdapter } from '../platform/adapter';
import type { SharedFacts } from './shared-context';

export interface ToolContext {
  project: DetectedProject;
  shared: SharedFacts;
  emit(event: string, payload: unknown): void;
  platform: PlatformAdapter;
}

export type ToolHandlers<C extends ToolContract> = {
  [K in keyof C]: (ctx: ToolContext, input: z.output<C[K]['input']>) => Promise<z.input<C[K]['output']>>;
};

export interface MainTool<S, C extends ToolContract> extends ToolDefinition<S> {
  contract: C;
  handlers: ToolHandlers<C>;
  /** Start watchers. */
  activate?(ctx: ToolContext): void;
  /** Kill processes, close servers. */
  dispose?(): Promise<void>;
}

/** Type-erased tool for the host's dynamic dispatch. */
export interface AnyMainTool extends ToolDefinition<unknown> {
  contract: ToolContract;
  handlers: Record<string, (ctx: ToolContext, input: unknown) => Promise<unknown>>;
  activate?(ctx: ToolContext): void;
  dispose?(): Promise<void>;
}

export function defineMainTool<S, C extends ToolContract>(tool: MainTool<S, C>): AnyMainTool {
  return tool as unknown as AnyMainTool;
}
```

- [ ] **Step 5: Write the failing tests**

`src/main/tools/shared-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSharedContext } from './shared-context';

describe('shared context', () => {
  it('stores facts per project', () => {
    const ctx = createSharedContext();
    ctx.forProject('a').publish('PORT', 3000);
    expect(ctx.forProject('a').get('PORT')).toBe(3000);
    expect(ctx.forProject('b').get('PORT')).toBeUndefined();
  });

  it('clears a project', () => {
    const ctx = createSharedContext();
    ctx.forProject('a').publish('PORT', 3000);
    ctx.clearProject('a');
    expect(ctx.forProject('a').get('PORT')).toBeUndefined();
  });
});
```

`src/main/tools/tool-host.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { defineContract } from '@shared/tool';
import { createMemoryLogger } from '../logger';
import { createDarwinAdapter } from '../platform/darwin';
import { projectInfoTool } from './project-info';
import { createSharedContext } from './shared-context';
import { createToolHost } from './tool-host';
import { defineMainTool } from './types';

const project: DetectedProject = {
  id: 'p1', rootId: 'p1', path: '/p', relPath: '', name: 'shop', missing: false,
  packageJson: { name: 'shop', scripts: {} }, packageManager: 'pnpm', envFiles: [], workspaces: [],
  prismaSchema: null, dockerCompose: null, git: null, buildOutput: null,
  claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
};

const echoContract = defineContract({
  echo: { input: z.strictObject({ text: z.string() }), output: z.object({ text: z.string() }) },
  broken: { input: z.strictObject({}), output: z.object({ n: z.number() }) },
});
const echoTool = defineMainTool({
  id: 'echo', name: 'Echo', icon: 'repeat', settingsSchema: z.object({}),
  appliesTo: (p) => p.packageManager === 'pnpm',
  contract: echoContract,
  handlers: {
    echo: async (ctx, input) => {
      ctx.shared.publish('last', input.text);
      ctx.emit('echoed', { text: input.text });
      return { text: input.text, extra: 'stripped' } as { text: string };
    },
    broken: async () => ({ n: 'not a number' }) as unknown as { n: number },
  },
});

function host(getProject = (id: string) => {
  if (id !== 'p1') throw new NestboxError('NOT_FOUND', 'Project not found');
  return project;
}) {
  const emit = vi.fn();
  const shared = createSharedContext();
  const h = createToolHost({
    tools: [projectInfoTool, echoTool],
    getProject,
    shared,
    platform: createDarwinAdapter({ runner: { launch: async () => {} }, getEditorCommand: () => 'code' }),
    emit,
    logger: createMemoryLogger(),
  });
  return { h, emit, shared };
}

describe('tool host', () => {
  it('lists tools that apply to the project', () => {
    expect(host().h.list('p1')).toEqual([
      { id: 'project-info', name: 'Project info', icon: 'info' },
      { id: 'echo', name: 'Echo', icon: 'repeat' },
    ]);
  });

  it('invokes the Project info tool and returns the detected project', async () => {
    expect(await host().h.invoke('project-info', 'p1', 'getFacts', {})).toEqual(project);
  });

  it('validates input, gives handlers a context and strips output', async () => {
    const { h, emit, shared } = host();
    expect(await h.invoke('echo', 'p1', 'echo', { text: 'hi' })).toEqual({ text: 'hi' });
    expect(shared.forProject('p1').get('last')).toBe('hi');
    expect(emit).toHaveBeenCalledWith({ toolId: 'echo', projectId: 'p1', event: 'echoed', payload: { text: 'hi' } });
  });

  it.each([
    ['unknown tool', 'nope', 'p1', 'echo', {}, 'NOT_FOUND'],
    ['unknown project', 'echo', 'p2', 'echo', {}, 'NOT_FOUND'],
    ['unknown method', 'echo', 'p1', 'nope', {}, 'NOT_FOUND'],
    ['prototype method name', 'echo', 'p1', 'toString', {}, 'NOT_FOUND'],
    ['invalid input', 'echo', 'p1', 'echo', { text: 1 }, 'VALIDATION'],
    ['invalid output', 'echo', 'p1', 'broken', {}, 'INTERNAL'],
  ])('rejects %s', async (_l, toolId, projectId, method, input, code) => {
    await expect(host().h.invoke(toolId, projectId, method, input)).rejects.toMatchObject({ code });
  });

  it('refuses tools that do not apply to the project', async () => {
    const { h } = host(() => ({ ...project, packageManager: null }));
    expect(h.list('p1').map((t) => t.id)).toEqual(['project-info']);
    await expect(h.invoke('echo', 'p1', 'echo', { text: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
```

`src/shared/tools/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toolContracts, toolDefinitions } from './index';

describe('shared tool registry', () => {
  it('has a contract for every definition', () => {
    expect(toolDefinitions.map((d) => d.id).sort()).toEqual(Object.keys(toolContracts).sort());
  });
});
```

- [ ] **Step 6: Run them and confirm they fail**

Run: `pnpm vitest run src/main/tools src/shared/tools`
Expected: FAIL, modules not found.

- [ ] **Step 7: Implement `src/main/tools/shared-context.ts`**

```ts
export interface SharedFacts {
  get(key: string): unknown;
  publish(key: string, value: unknown): void;
}

export interface SharedContext {
  forProject(projectId: string): SharedFacts;
  clearProject(projectId: string): void;
}

export function createSharedContext(): SharedContext {
  const facts = new Map<string, Map<string, unknown>>();
  return {
    forProject(projectId) {
      return {
        get: (key) => facts.get(projectId)?.get(key),
        publish: (key, value) => {
          const bucket = facts.get(projectId) ?? new Map<string, unknown>();
          bucket.set(key, value);
          facts.set(projectId, bucket);
        },
      };
    },
    clearProject(projectId) {
      facts.delete(projectId);
    },
  };
}
```

- [ ] **Step 8: Implement `src/main/tools/tool-host.ts`**

```ts
import type { DetectedProject } from '@shared/detected';
import { describeIssues, NestboxError } from '@shared/errors';
import type { ToolSummary } from '@shared/tool';
import type { Logger } from '../logger';
import type { PlatformAdapter } from '../platform/adapter';
import type { SharedContext } from './shared-context';
import type { AnyMainTool, ToolContext } from './types';

export interface ToolEventPayload {
  toolId: string;
  projectId: string;
  event: string;
  payload: unknown;
}

export interface ToolHostDeps {
  tools: readonly AnyMainTool[];
  /** Throws NestboxError NOT_FOUND for unknown ids. */
  getProject(projectId: string): DetectedProject;
  shared: SharedContext;
  platform: PlatformAdapter;
  emit(payload: ToolEventPayload): void;
  logger: Logger;
}

export interface ToolHost {
  list(projectId: string): ToolSummary[];
  invoke(toolId: string, projectId: string, method: string, input: unknown): Promise<unknown>;
  disposeAll(): Promise<void>;
}

export function createToolHost(deps: ToolHostDeps): ToolHost {
  const byId = new Map(deps.tools.map((tool) => [tool.id, tool]));

  function context(tool: AnyMainTool, project: DetectedProject): ToolContext {
    return {
      project,
      shared: deps.shared.forProject(project.id),
      emit: (event, payload) => deps.emit({ toolId: tool.id, projectId: project.id, event, payload }),
      platform: deps.platform,
    };
  }

  return {
    list(projectId) {
      const project = deps.getProject(projectId);
      return deps.tools
        .filter((tool) => tool.appliesTo(project))
        .map(({ id, name, icon }) => ({ id, name, icon }));
    },

    async invoke(toolId, projectId, method, input) {
      const tool = byId.get(toolId);
      if (!tool) throw new NestboxError('NOT_FOUND', `Unknown tool: ${toolId}`);
      const project = deps.getProject(projectId);
      if (!tool.appliesTo(project)) {
        throw new NestboxError('NOT_FOUND', `Tool ${toolId} does not apply to this project`);
      }
      const spec = Object.hasOwn(tool.contract, method) ? tool.contract[method] : undefined;
      const handler = Object.hasOwn(tool.handlers, method) ? tool.handlers[method] : undefined;
      if (!spec || !handler) throw new NestboxError('NOT_FOUND', `Unknown method: ${toolId}.${method}`);

      const parsed = spec.input.safeParse(input);
      if (!parsed.success) {
        throw new NestboxError('VALIDATION', `Invalid input for ${toolId}.${method}: ${describeIssues(parsed.error)}`);
      }
      const result = await handler(context(tool, project), parsed.data);
      const output = spec.output.safeParse(result);
      if (!output.success) {
        deps.logger.error('tool returned invalid output', { toolId, method });
        throw new NestboxError('INTERNAL', `${toolId}.${method} returned invalid output`);
      }
      return output.data;
    },

    async disposeAll() {
      await Promise.allSettled(deps.tools.map((tool) => tool.dispose?.()));
    },
  };
}
```

- [ ] **Step 9: Implement the Project info main half and the registry**

`src/main/tools/project-info/index.ts`:

```ts
import { projectInfoContract, projectInfoDefinition } from '@shared/tools/project-info/contract';
import { defineMainTool } from '../types';

export const projectInfoTool = defineMainTool({
  ...projectInfoDefinition,
  contract: projectInfoContract,
  handlers: {
    getFacts: async (ctx) => ctx.project,
  },
});
```

`src/main/tools/index.ts`:

```ts
import { projectInfoTool } from './project-info';
import type { AnyMainTool } from './types';

/** Tool registry, main half. */
export const mainTools: readonly AnyMainTool[] = [projectInfoTool];
```

- [ ] **Step 10: Run the tests and confirm they pass**

Run: `pnpm vitest run src/main/tools src/shared && pnpm typecheck && pnpm lint`
Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/shared src/main/tools
git commit -m "feat(tools): add tool contracts, tool host, shared context and Project info tool

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Preload bridge and typed client

**Refinement of the design notes:** `contextBridge` copies only `message` (and sometimes `stack`) from `Error` objects, so a `code` thrown in the preload would never reach the renderer. The preload therefore exposes `window.nestbox` as a whitelisted bridge that returns the result envelope unchanged. The shared `createNestboxClient` then unwraps it in the renderer and throws `NestboxError`. Record this in `CLAUDE.md` (Task 17).

**Files:**
- Create: `src/shared/bridge.ts`, `src/shared/client.ts`, `src/preload/bridge.ts`
- Modify: `src/preload/index.ts`
- Test: `src/preload/bridge.test.ts`, `src/shared/client.test.ts`

**Interfaces:**
- Consumes: `INVOKE_CHANNELS`/`EVENT_CHANNELS` and their guards, plus `ChannelInput`/`ChannelOutput` (Task 10); `NestboxError` and `IpcEnvelope` (Task 3); `ToolId`, `ToolMethodName`, `ToolMethodInput` and `ToolMethodOutput` (Task 11).
- Produces:
  - **`shared/bridge.ts`:** `NestboxBridge`, with:
    - `invoke<C>(channel: C, input?: ChannelInput<C>): Promise<IpcEnvelope<ChannelOutput<C>>>`
    - `on(event: EventChannel, listener: (payload: unknown) => void): () => void`
  - **`preload/bridge.ts`:** `IpcRendererLike`, `createBridge(ipc): NestboxBridge`.
  - **`shared/client.ts`:** `createNestboxClient(getBridge: () => NestboxBridge)` and `type NestboxClient`. The client offers:
    - `app.getInfo()`, `dialog.pickFolder()`
    - `projects.{list, add, remove, rename, setPinned, refresh, openInEditor, openTerminal}`
    - `tools.list(projectId)`, `tools.invoke(toolId, projectId, method, input)`
    - `on(event, listener)`

- [ ] **Step 1: Write `src/shared/bridge.ts`.** Type-only imports keep zod out of the preload bundle.

```ts
import type { ChannelInput, ChannelOutput } from './channels';
import type { IpcEnvelope } from './errors';
import type { EventChannel, InvokeChannel } from './ipc-names';

/** The object the preload exposes as window.nestbox. */
export interface NestboxBridge {
  invoke<C extends InvokeChannel>(channel: C, input?: ChannelInput<C>): Promise<IpcEnvelope<ChannelOutput<C>>>;
  on(event: EventChannel, listener: (payload: unknown) => void): () => void;
}
```

- [ ] **Step 2: Write the failing tests**

`src/preload/bridge.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createBridge, type IpcRendererLike } from './bridge';

function fakeIpc(): IpcRendererLike & { listeners: Map<string, (e: unknown, p: unknown) => void> } {
  const listeners = new Map<string, (e: unknown, p: unknown) => void>();
  return {
    listeners,
    invoke: vi.fn(async () => ({ ok: true, data: [] })),
    on: vi.fn((ch: string, l: (e: unknown, p: unknown) => void) => listeners.set(ch, l)),
    removeListener: vi.fn((ch: string) => listeners.delete(ch)),
  };
}

describe('preload bridge', () => {
  it('forwards whitelisted invokes untouched', async () => {
    const ipc = fakeIpc();
    const bridge = createBridge(ipc);
    expect(await bridge.invoke('projects:list')).toEqual({ ok: true, data: [] });
    expect(ipc.invoke).toHaveBeenCalledWith('projects:list', undefined);
  });

  it('rejects channels that are not whitelisted', async () => {
    const ipc = fakeIpc();
    const bridge = createBridge(ipc);
    await expect(bridge.invoke('fs:readFile' as never)).rejects.toThrow(/not allowed/);
    expect(ipc.invoke).not.toHaveBeenCalled();
  });

  it('subscribes to whitelisted events without leaking the IPC event object', () => {
    const ipc = fakeIpc();
    const bridge = createBridge(ipc);
    const listener = vi.fn();
    const off = bridge.on('projects:changed', listener);
    ipc.listeners.get('projects:changed')?.({ sender: 'secret' }, 42);
    expect(listener).toHaveBeenCalledWith(42);
    off();
    expect(ipc.removeListener).toHaveBeenCalled();
  });

  it('refuses non-whitelisted events', () => {
    expect(() => createBridge(fakeIpc()).on('ipc:raw' as never, () => {})).toThrow(/not allowed/);
  });
});
```

`src/shared/client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { NestboxBridge } from './bridge';
import { createNestboxClient } from './client';
import { NestboxError } from './errors';

function bridgeReturning(envelope: unknown): NestboxBridge & { invoke: ReturnType<typeof vi.fn> } {
  return { invoke: vi.fn(async () => envelope), on: vi.fn(() => () => {}) } as never;
}

describe('nestbox client', () => {
  it('unwraps ok envelopes', async () => {
    const bridge = bridgeReturning({ ok: true, data: 'C:\\Dev\\Shop' });
    const client = createNestboxClient(() => bridge);
    expect(await client.dialog.pickFolder()).toBe('C:\\Dev\\Shop');
  });

  it('throws NestboxError with the code from error envelopes', async () => {
    const bridge = bridgeReturning({ ok: false, error: { code: 'CONFLICT', message: 'dup' } });
    const client = createNestboxClient(() => bridge);
    const error = await client.projects.add('C:\\x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NestboxError);
    expect(error).toMatchObject({ code: 'CONFLICT', message: 'dup' });
  });

  it('builds channel payloads', async () => {
    const bridge = bridgeReturning({ ok: true, data: undefined });
    const client = createNestboxClient(() => bridge);
    await client.projects.rename('a', 'b');
    await client.tools.invoke('project-info', 'p1', 'getFacts', {});
    expect(bridge.invoke).toHaveBeenNthCalledWith(1, 'projects:rename', { id: 'a', name: 'b' });
    expect(bridge.invoke).toHaveBeenNthCalledWith(2, 'tools:invoke', {
      toolId: 'project-info',
      projectId: 'p1',
      method: 'getFacts',
      input: {},
    });
  });

  it('resolves the bridge lazily', async () => {
    let bridge: NestboxBridge | undefined;
    const client = createNestboxClient(() => {
      if (!bridge) throw new Error('no bridge yet');
      return bridge;
    });
    bridge = bridgeReturning({ ok: true, data: [] });
    expect(await client.projects.list()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `pnpm vitest run src/preload src/shared/client.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `src/preload/bridge.ts`**

```ts
import type { NestboxBridge } from '@shared/bridge';
import { isEventChannel, isInvokeChannel } from '@shared/ipc-names';

type Listener = (event: unknown, ...args: unknown[]) => void;

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: Listener): unknown;
  removeListener(channel: string, listener: Listener): unknown;
}

export function createBridge(ipc: IpcRendererLike): NestboxBridge {
  const invoke = (channel: string, input?: unknown): Promise<unknown> => {
    if (!isInvokeChannel(channel)) {
      return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    }
    return ipc.invoke(channel, input);
  };

  return {
    invoke: invoke as unknown as NestboxBridge['invoke'],
    on(event, listener) {
      if (!isEventChannel(event)) throw new Error(`Event not allowed: ${String(event)}`);
      const wrapped: Listener = (_event, payload) => listener(payload);
      ipc.on(event, wrapped);
      return () => {
        ipc.removeListener(event, wrapped);
      };
    },
  };
}
```

- [ ] **Step 5: Replace `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { createBridge } from './bridge';

contextBridge.exposeInMainWorld('nestbox', createBridge(ipcRenderer));
```

- [ ] **Step 6: Implement `src/shared/client.ts`**

```ts
import type { NestboxBridge } from './bridge';
import type { ChannelInput, ChannelOutput } from './channels';
import { NestboxError } from './errors';
import type { EventChannel, InvokeChannel } from './ipc-names';
import type { ToolId, ToolMethodInput, ToolMethodName, ToolMethodOutput } from './tools';

export function createNestboxClient(getBridge: () => NestboxBridge) {
  async function call<C extends InvokeChannel>(channel: C, input?: ChannelInput<C>): Promise<ChannelOutput<C>> {
    const envelope = await getBridge().invoke(channel, input);
    if (envelope.ok) return envelope.data;
    throw new NestboxError(envelope.error.code, envelope.error.message);
  }

  return {
    app: {
      getInfo: () => call('app:getInfo'),
    },
    dialog: {
      pickFolder: () => call('dialog:pickFolder'),
    },
    projects: {
      list: () => call('projects:list'),
      add: (path: string) => call('projects:add', { path }),
      remove: (id: string) => call('projects:remove', { id }),
      rename: (id: string, name: string) => call('projects:rename', { id, name }),
      setPinned: (id: string, pinned: boolean) => call('projects:setPinned', { id, pinned }),
      refresh: (id: string) => call('projects:refresh', { id }),
      openInEditor: (id: string) => call('projects:openInEditor', { id }),
      openTerminal: (id: string) => call('projects:openTerminal', { id }),
    },
    tools: {
      list: (projectId: string) => call('tools:list', { projectId }),
      invoke: <T extends ToolId, M extends ToolMethodName<T>>(
        toolId: T,
        projectId: string,
        method: M,
        input: ToolMethodInput<T, M>,
      ) => call('tools:invoke', { toolId, projectId, method, input }) as Promise<ToolMethodOutput<T, M>>,
    },
    on: (event: EventChannel, listener: (payload: unknown) => void) => getBridge().on(event, listener),
  };
}

export type NestboxClient = ReturnType<typeof createNestboxClient>;
```

- [ ] **Step 7: Run the tests, then build and confirm the preload bundle has no zod**

Run: `pnpm vitest run src/preload src/shared && pnpm typecheck && pnpm lint && pnpm build`
Expected: all tests pass, and the build succeeds.

Then run: `grep -c "zod" out/preload/index.js || true` and expect `0`.

- [ ] **Step 8: Commit**

```bash
git add src/shared src/preload
git commit -m "feat(ipc): expose whitelisted window.nestbox bridge and typed renderer client

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Main process wiring: security, assets, window and core handlers

**Files:**
- Create: `src/main/security/origin.ts`, `src/main/security/harden.ts`, `src/main/assets.ts`, `src/main/window-theme.ts`, `src/main/window.ts`, `src/main/ipc/core-handlers.ts`
- Modify: `src/main/index.ts` (replace the Task 1 version)
- Test: `src/main/security/origin.test.ts`, `src/main/security/csp.test.ts`, `src/main/assets.test.ts`, `src/main/ipc/core-handlers.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–12.
- Produces:
  - `isAppUrl(url: string, devServerUrl?: string): boolean`
  - `hardenWebContents(contents, isAllowedUrl)` and `applySessionSecurity(session, opts)`
  - `brandAsset(env: AssetEnv, relPath: string): string`
  - `WINDOW_COLORS`
  - `createMainWindow(opts): BrowserWindow`
  - `createCoreHandlers(deps: CoreHandlerDeps): CoreHandlers`

- [ ] **Step 1: Write the failing tests**

`src/main/security/origin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAppUrl } from './origin';

describe('isAppUrl', () => {
  it('accepts the dev server origin in dev', () => {
    expect(isAppUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAppUrl('http://localhost:5173/index.html#x', 'http://localhost:5173')).toBe(true);
  });

  it('rejects other origins in dev, including file:', () => {
    expect(isAppUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
    expect(isAppUrl('file:///C:/app/index.html', 'http://localhost:5173')).toBe(false);
  });

  it('accepts only file: URLs when packaged', () => {
    expect(isAppUrl('file:///C:/Program%20Files/Nestbox/resources/app.asar/out/renderer/index.html')).toBe(true);
    expect(isAppUrl('https://example.com/')).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isAppUrl('')).toBe(false);
    expect(isAppUrl('not a url', 'http://localhost:5173')).toBe(false);
  });
});
```

`src/main/security/csp.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

describe('buildCsp', () => {
  it('is strict in production', () => {
    const csp = buildCsp({ dev: false });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/https?:/);
  });

  it('only relaxes what Vite HMR needs in dev', () => {
    const csp = buildCsp({ dev: true });
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain('ws://localhost:*');
    expect(csp).not.toContain('unsafe-eval');
  });
});
```

`src/main/assets.test.ts`:

```ts
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brandAsset } from './assets';

describe('brandAsset', () => {
  it('resolves from the app root in dev', () => {
    expect(brandAsset({ isPackaged: false, appPath: '/repo', resourcesPath: '/ignored' }, 'png/nestbox.ico')).toBe(
      join('/repo', 'resources', 'brand', 'png', 'nestbox.ico'),
    );
  });

  it('resolves from resourcesPath when packaged (extraResources → brand/)', () => {
    expect(brandAsset({ isPackaged: true, appPath: '/ignored', resourcesPath: '/app/resources' }, 'png/nestbox.ico')).toBe(
      join('/app/resources', 'brand', 'png', 'nestbox.ico'),
    );
  });
});
```

`src/main/ipc/core-handlers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { DetectedProject } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { createCoreHandlers, type CoreHandlerDeps } from './core-handlers';

const detected = (over: Partial<DetectedProject> = {}): DetectedProject => ({
  id: 'p1', rootId: 'p1', path: 'C:\\Dev\\R&D Shop', relPath: '', name: 'shop', missing: false,
  packageJson: null, packageManager: null, envFiles: [], workspaces: [], prismaSchema: null,
  dockerCompose: null, git: null, buildOutput: null,
  claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
  ...over,
});

function deps(over: Partial<CoreHandlerDeps> = {}): CoreHandlerDeps {
  return {
    projects: {
      list: vi.fn(), add: vi.fn(), remove: vi.fn(), rename: vi.fn(), setPinned: vi.fn(),
      refresh: vi.fn(async () => ({}) as never),
      getDetected: vi.fn(() => detected()),
    },
    toolHost: { list: vi.fn(() => []), invoke: vi.fn(), disposeAll: vi.fn() },
    platform: { openInEditor: vi.fn(async () => {}), openTerminal: vi.fn(async () => {}) },
    appInfo: () => ({ version: '0.0.0', platform: 'win32' }),
    pickFolder: vi.fn(async () => null),
    isDirectory: vi.fn(async () => true),
    ...over,
  };
}

describe('core handlers', () => {
  it('opens the editor with the stored path, unchanged', async () => {
    const d = deps();
    await createCoreHandlers(d)['projects:openInEditor']({ id: 'p1' });
    expect(d.platform.openInEditor).toHaveBeenCalledWith('C:\\Dev\\R&D Shop');
  });

  it('opens a terminal for a workspace package path', async () => {
    const d = deps();
    vi.mocked(d.projects.getDetected).mockReturnValue(detected({ id: 'p1::packages/api', path: 'C:\\Dev\\Shop\\packages\\api' }));
    await createCoreHandlers(d)['projects:openTerminal']({ id: 'p1::packages/api' });
    expect(d.platform.openTerminal).toHaveBeenCalledWith('C:\\Dev\\Shop\\packages\\api');
  });

  it('refuses and re-detects when the folder vanished since detection', async () => {
    const d = deps({ isDirectory: vi.fn(async () => false) });
    const handlers = createCoreHandlers(d);
    await expect(handlers['projects:openInEditor']({ id: 'p1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'The project folder no longer exists',
    });
    expect(d.projects.refresh).toHaveBeenCalledWith('p1');
    expect(d.platform.openInEditor).not.toHaveBeenCalled();
  });

  it('refuses when detection already marked the project missing', async () => {
    const d = deps();
    vi.mocked(d.projects.getDetected).mockReturnValue(detected({ missing: true }));
    await expect(createCoreHandlers(d)['projects:openTerminal']({ id: 'p1' })).rejects.toBeInstanceOf(NestboxError);
  });

  it('delegates tools:invoke to the tool host', async () => {
    const d = deps();
    await createCoreHandlers(d)['tools:invoke']({ toolId: 't', projectId: 'p1', method: 'm', input: {} });
    expect(d.toolHost.invoke).toHaveBeenCalledWith('t', 'p1', 'm', {});
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run src/main/security src/main/assets.test.ts src/main/ipc/core-handlers.test.ts`
Expected: the new modules fail with module-not-found errors. `csp.test.ts` already passes because `csp.ts` exists from Task 1; that's expected.

- [ ] **Step 3: Implement `src/main/security/origin.ts`**

```ts
/** True when `url` belongs to Nestbox's own renderer. */
export function isAppUrl(url: string, devServerUrl?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (devServerUrl) {
    try {
      return parsed.origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  return parsed.protocol === 'file:';
}
```

- [ ] **Step 4: Implement `src/main/assets.ts`**

```ts
import { join } from 'node:path';

export interface AssetEnv {
  isPackaged: boolean;
  /** app.getAppPath() — the repo root in dev. */
  appPath: string;
  /** process.resourcesPath — where extraResources land when packaged. */
  resourcesPath: string;
}

/** Single resolver for files under resources/brand (packaged as extraResources → brand/). */
export function brandAsset(env: AssetEnv, relPath: string): string {
  const base = env.isPackaged ? join(env.resourcesPath, 'brand') : join(env.appPath, 'resources', 'brand');
  return join(base, ...relPath.split('/'));
}
```

- [ ] **Step 5: Implement `src/main/ipc/core-handlers.ts`**

```ts
import { NestboxError } from '@shared/errors';
import type { AppInfo } from '@shared/types';
import type { PlatformAdapter } from '../platform/adapter';
import type { ProjectService } from '../projects/project-service';
import type { ToolHost } from '../tools/tool-host';
import type { CoreHandlers } from './router';

export interface CoreHandlerDeps {
  projects: Pick<ProjectService, 'list' | 'add' | 'remove' | 'rename' | 'setPinned' | 'refresh' | 'getDetected'>;
  toolHost: ToolHost;
  platform: Pick<PlatformAdapter, 'openInEditor' | 'openTerminal'>;
  appInfo(): AppInfo;
  pickFolder(): Promise<string | null>;
  isDirectory(path: string): Promise<boolean>;
}

export function createCoreHandlers(deps: CoreHandlerDeps): CoreHandlers {
  /** The project folder as it exists right now — re-checked at click time, not trusted from the cache. */
  async function existingPath(id: string): Promise<string> {
    const project = deps.projects.getDetected(id);
    if (project.missing || !(await deps.isDirectory(project.path))) {
      await deps.projects.refresh(id).catch(() => undefined);
      throw new NestboxError('NOT_FOUND', 'The project folder no longer exists');
    }
    return project.path;
  }

  return {
    'app:getInfo': async () => deps.appInfo(),
    'dialog:pickFolder': () => deps.pickFolder(),
    'projects:list': () => deps.projects.list(),
    'projects:add': ({ path }) => deps.projects.add(path),
    'projects:remove': async ({ id }) => {
      deps.projects.remove(id);
    },
    'projects:rename': async ({ id, name }) => deps.projects.rename(id, name),
    'projects:setPinned': async ({ id, pinned }) => deps.projects.setPinned(id, pinned),
    'projects:refresh': ({ id }) => deps.projects.refresh(id),
    'projects:openInEditor': async ({ id }) => {
      await deps.platform.openInEditor(await existingPath(id));
    },
    'projects:openTerminal': async ({ id }) => {
      await deps.platform.openTerminal(await existingPath(id));
    },
    'tools:list': async ({ projectId }) => deps.toolHost.list(projectId),
    'tools:invoke': ({ toolId, projectId, method, input }) => deps.toolHost.invoke(toolId, projectId, method, input),
  };
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm vitest run src/main && pnpm typecheck`
Expected: all tests pass.

- [ ] **Step 7: Implement the Electron-bound modules.** They have no unit tests; they are verified by the manual run in Step 9 and in Task 17.

`src/main/window-theme.ts`:

```ts
/** Window chrome colours (main process only; renderer uses CSS tokens). Values from docs/design/DESIGN-NOTES.md. */
export const WINDOW_COLORS = {
  background: '#0D1117',
  titleBar: '#161B22',
  titleBarSymbols: '#C9D1D9',
} as const;

export const TITLE_BAR_HEIGHT = 40;
```

`src/main/security/harden.ts`:

```ts
import type { Session, WebContents } from 'electron';

export function hardenWebContents(contents: WebContents, isAllowedUrl: (url: string) => boolean): void {
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

export function applySessionSecurity(session: Session, opts: { devCsp?: string }): void {
  session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  if (opts.devCsp) {
    const csp = opts.devCsp;
    // Production CSP is a <meta> tag injected at build time; dev needs it as a header.
    session.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  }
}
```

`src/main/window.ts`:

```ts
import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { PlatformAdapter } from './platform/adapter';
import { hardenWebContents } from './security/harden';
import { TITLE_BAR_HEIGHT, WINDOW_COLORS } from './window-theme';

export interface MainWindowOptions {
  platform: PlatformAdapter;
  devServerUrl: string | undefined;
  isAllowedUrl(url: string): boolean;
  icon: string;
}

export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: WINDOW_COLORS.background,
    icon: opts.icon,
    ...opts.platform.windowChrome({
      color: WINDOW_COLORS.titleBar,
      symbolColor: WINDOW_COLORS.titleBarSymbols,
      height: TITLE_BAR_HEIGHT,
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  hardenWebContents(win.webContents, opts.isAllowedUrl);
  win.once('ready-to-show', () => win.show());
  if (opts.devServerUrl) void win.loadURL(opts.devServerUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}
```

`src/main/index.ts` (replace entirely):

```ts
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { app, type BrowserWindow, dialog, ipcMain, session } from 'electron';
import type { EventChannel } from '@shared/ipc-names';
import { brandAsset } from './assets';
import { detectProject } from './detection/detect-project';
import { isDirectory } from './detection/fs-utils';
import { createCoreHandlers } from './ipc/core-handlers';
import { registerIpc } from './ipc/register';
import { createRouter } from './ipc/router';
import { createConsoleLogger } from './logger';
import { spawnRunner } from './platform/command-runner';
import { createPlatformAdapter } from './platform';
import { ProjectService } from './projects/project-service';
import { buildCsp } from './security/csp';
import { applySessionSecurity } from './security/harden';
import { isAppUrl } from './security/origin';
import { createElectronStoreBackend } from './store/electron-store-backend';
import { StoreService } from './store/store-service';
import { mainTools } from './tools';
import { createSharedContext } from './tools/shared-context';
import { createToolHost } from './tools/tool-host';
import { createMainWindow } from './window';

const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  const logger = createConsoleLogger();

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => app.quit()); // M1: hide to tray when closeToTray is set

  void app.whenReady().then(async () => {
    const store = new StoreService(createElectronStoreBackend(app.getPath('userData')), logger);
    const platform = createPlatformAdapter({
      runner: spawnRunner,
      getEditorCommand: () => store.getSettings().editorCommand,
    });
    const emit = (channel: EventChannel, payload?: unknown): void => {
      mainWindow?.webContents.send(channel, payload);
    };

    const projects = new ProjectService({
      store,
      samePath: platform.samePath,
      resolvePath: (p) => resolve(p),
      isDirectory,
      detect: (input) =>
        detectProject(input, {
          onWarning: (file, reason) => logger.warn('detection skipped a file', { file, reason }),
        }),
      newId: randomUUID,
      onChanged: () => emit('projects:changed'),
    });
    await projects.init();

    const toolHost = createToolHost({
      tools: mainTools,
      getProject: (id) => projects.getDetected(id),
      shared: createSharedContext(),
      platform,
      emit: (payload) => emit('tools:event', payload),
      logger,
    });
    app.on('before-quit', () => {
      void toolHost.disposeAll();
    });

    const isTrusted = (url: string): boolean => isAppUrl(url, devServerUrl);
    const dispatch = createRouter({
      handlers: createCoreHandlers({
        projects,
        toolHost,
        platform,
        isDirectory,
        appInfo: () => ({ version: app.getVersion(), platform: platform.id }),
        pickFolder: async () => {
          const options = { properties: ['openDirectory' as const], title: 'Add project folder' };
          const result = mainWindow
            ? await dialog.showOpenDialog(mainWindow, options)
            : await dialog.showOpenDialog(options);
          return result.canceled ? null : (result.filePaths[0] ?? null);
        },
      }),
      isTrustedSender: isTrusted,
      logger,
    });
    registerIpc(ipcMain, dispatch);

    applySessionSecurity(session.defaultSession, devServerUrl ? { devCsp: buildCsp({ dev: true }) } : {});

    mainWindow = createMainWindow({
      platform,
      devServerUrl,
      isAllowedUrl: isTrusted,
      icon: brandAsset(
        { isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath },
        'png/nestbox.ico',
      ),
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });
}
```

- [ ] **Step 8: Run the full checks**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: everything passes.

Also run `grep -rn "process.platform" src --include=*.ts --include=*.tsx`. The only hits allowed are in `src/main/platform/` (`index.ts` and `win32-escape.test.ts`).

- [ ] **Step 9: Smoke-run the app**

Run: `pnpm dev`. Expected:
- The window opens with the native Windows caption buttons on a dark title strip.
- The terminal shows `[nestbox] ipc` log lines only after the renderer starts calling. The Task 1 placeholder page doesn't call anything yet, so there may be none.
- A `config.json` appears in `%APPDATA%\nestbox\`, containing `"schemaVersion": 1`.

Close the window.

- [ ] **Step 10: Commit**

```bash
git add src/main
git commit -m "feat(main): wire services, hardened window, CSP, single-instance lock and core IPC handlers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Renderer foundation: tokens, fonts, shadcn, data layer and test harness

**Files:**
- Modify: `electron.vite.config.ts` (add the Tailwind and svgr plugins), `vitest.config.ts` (add svgr and the renderer setup file), `tsconfig.web.json` (add types), `src/renderer/env.d.ts`, `src/renderer/main.tsx`
- Create: `components.json`, `src/renderer/styles/globals.css`, `src/renderer/lib/utils.ts`, `src/renderer/lib/api.ts`, `src/renderer/lib/errors.ts`, `src/renderer/lib/queries.ts`, `src/renderer/state/ui-store.ts`, `src/renderer/components/NestboxMark.tsx`, `src/renderer/test/setup.ts`, `src/renderer/test/mock-bridge.ts`, `src/renderer/test/fixtures.ts`, `src/renderer/test/render.tsx`
- Generate: `src/renderer/components/ui/{button,input,badge,dropdown-menu,alert-dialog}.tsx` (shadcn CLI)
- Test: `src/renderer/state/ui-store.test.ts`, `src/renderer/lib/queries.test.tsx`

**Interfaces:**
- Consumes: `createNestboxClient` and `NestboxBridge` (Task 12); `NestboxError` (Task 3); `ProjectSummary` and `DetectedProject` (Task 3).
- Produces:
  - **Client:** `api: NestboxClient` from `@/lib/api`.
  - **Errors:** `errorMessage(e: unknown): string`.
  - **Query keys:** `queryKeys`.
  - **Query hooks:** `useProjects()`, `useAppInfo()`, `useTools(projectId: string | null)`.
  - **Mutation hooks:** `useAddProject()`, `useRemoveProject()`, `useRenameProject()`, `useSetPinned()`, `useRefreshProject()`, `useOpenInEditor()`, `useOpenTerminal()`.
  - **Subscription:** `useProjectsChangedSubscription()`.
  - **UI store:** `useUiStore` (`selectedProjectId`, `activeTab`, `filter`, `collapsed`, `select`, `setActiveTab`, `setFilter`, `toggleCollapsed`) and `initialUiState`.
  - **Brand:** `<NestboxMark className? />`.
  - **Test helpers:** `installMockBridge(handlers)`, `renderWithProviders(ui)`, `makeDetected(over)`, `makeSummary(over)`.
  - **Tailwind token utilities:**
    - Surfaces: `bg-app`, `bg-card`, `bg-surface`, `bg-hover`, `border-line`
    - Text: `text-fg`, `text-fg-muted`, `text-fg-faint`
    - Accent: `text-brand`/`bg-brand`, `bg-brand-hover`
    - Status: `ok`, `warn`, `err`, `idle`, in each colour slot
    - Fonts: `font-sans`, `font-mono`
    - Window dragging: `drag` and `no-drag`

**Order:** after Step 4, write the Step 9 tests and run them to watch them fail (missing modules). Then do Steps 5–8 and Step 10. Steps 1–4 are setup with nothing to test first.

- [ ] **Step 1: Install the renderer dependencies**

```bash
pnpm add -D tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 tw-animate-css@1.4.0 class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.7.0 lucide-react@1.49.0 @tanstack/react-query@5.104.0 zustand@5.0.15 sonner@2.0.8 vite-plugin-svgr@5.2.0 @fontsource-variable/inter@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0
```

Renderer packages are devDependencies because Vite bundles them. Only packages the main process requires at runtime stay in `dependencies`.

- [ ] **Step 2: Wire Tailwind and svgr into the build and tests**

`electron.vite.config.ts`: add the imports and plugins to `renderer`:

```ts
import tailwindcss from '@tailwindcss/vite';
import svgr from 'vite-plugin-svgr';
// …
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer'), '@shared': shared, '@brand': resolve('resources/brand') } },
    plugins: [react(), tailwindcss(), svgr(), cspMeta()],
  },
```

`vitest.config.ts`: replace the renderer project with:

```ts
      {
        extends: true,
        plugins: [react(), svgr()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/test/setup.ts'],
        },
      },
```

Add `import svgr from 'vite-plugin-svgr';` at the top, and remove `passWithNoTests` (this task adds renderer tests).

`tsconfig.web.json`: set `"types": ["vite/client", "vite-plugin-svgr/client", "@testing-library/jest-dom/vitest"]`.

`src/renderer/env.d.ts`:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />
import type { NestboxBridge } from '@shared/bridge';

declare global {
  interface Window {
    nestbox: NestboxBridge;
  }
}
```

- [ ] **Step 3: Write `src/renderer/styles/globals.css`.** This is the only place hex colours are allowed in the renderer.

```css
@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

/* Nestbox design tokens — docs/design/DESIGN-NOTES.md. Dark only in M0. */
:root {
  --nb-bg: #0d1117;
  --nb-card: #161b22;
  --nb-surface: #21262d;
  --nb-hover: #2a303c;
  --nb-border: #30363d;
  --nb-text: #c9d1d9;
  --nb-text-muted: #8b949e;
  --nb-text-faint: #484f58;
  --nb-accent: #7c8cff;
  --nb-accent-hover: #697afa;
  --nb-green: #3fb950;
  --nb-amber: #d29922;
  --nb-red: #f85149;
  --nb-grey: #8b949e;

  /* shadcn/ui variables mapped onto the Nestbox tokens */
  --radius: 0.375rem;
  --background: var(--nb-bg);
  --foreground: var(--nb-text);
  --card: var(--nb-card);
  --card-foreground: var(--nb-text);
  --popover: var(--nb-card);
  --popover-foreground: var(--nb-text);
  --primary: var(--nb-accent);
  --primary-foreground: var(--nb-bg);
  --secondary: var(--nb-surface);
  --secondary-foreground: var(--nb-text);
  --muted: var(--nb-surface);
  --muted-foreground: var(--nb-text-muted);
  --accent: var(--nb-hover);
  --accent-foreground: var(--nb-text);
  --destructive: var(--nb-red);
  --border: var(--nb-border);
  --input: var(--nb-border);
  --ring: var(--nb-accent);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);
  --radius-xl: calc(var(--radius) + 4px);

  /* Nestbox names used by app code */
  --color-app: var(--nb-bg);
  --color-surface: var(--nb-surface);
  --color-hover: var(--nb-hover);
  --color-line: var(--nb-border);
  --color-fg: var(--nb-text);
  --color-fg-muted: var(--nb-text-muted);
  --color-fg-faint: var(--nb-text-faint);
  --color-brand: var(--nb-accent);
  --color-brand-hover: var(--nb-accent-hover);
  --color-ok: var(--nb-green);
  --color-warn: var(--nb-amber);
  --color-err: var(--nb-red);
  --color-idle: var(--nb-grey);

  --font-sans: 'Inter Variable', 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono Variable', 'Cascadia Mono', ui-monospace, monospace;
}

@utility drag {
  -webkit-app-region: drag;
}

@utility no-drag {
  -webkit-app-region: no-drag;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  html,
  body,
  #root {
    height: 100%;
  }
  body {
    @apply bg-background font-sans text-foreground antialiased;
  }
}
```

- [ ] **Step 4: Write `components.json` and `src/renderer/lib/utils.ts`, then generate the shadcn components**

`components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

`src/renderer/lib/utils.ts`:

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

Run: `pnpm dlx shadcn@4.21.0 add button input badge dropdown-menu alert-dialog --yes`

Then:
1. Run `git diff src/renderer/styles/globals.css`. If the CLI edited the file, revert it with `git checkout src/renderer/styles/globals.css`, because our token mapping is the source of truth.
2. Check `package.json`. Any packages the CLI added under `dependencies` (for example `radix-ui` or `@radix-ui/*`) move to `devDependencies`, since the renderer is bundled. Use `pnpm remove <pkg> && pnpm add -D <pkg>@<same version>`.
3. Confirm the generated components use Radix `asChild` triggers: `grep -n "asChild" src/renderer/components/ui/dropdown-menu.tsx` should find matches. If the CLI produced Base UI components (a `render` prop instead of `asChild`), adapt the trigger usages in Task 16 accordingly and record the fact in `CLAUDE.md`.

- [ ] **Step 5: Write `src/renderer/lib/api.ts`, `errors.ts` and `state/ui-store.ts`**

`src/renderer/lib/api.ts`:

```ts
import { createNestboxClient } from '@shared/client';

/** Typed client over window.nestbox. Resolved lazily so tests can install a mock bridge first. */
export const api = createNestboxClient(() => window.nestbox);
```

`src/renderer/lib/errors.ts`:

```ts
import { NestboxError } from '@shared/errors';

export function errorMessage(error: unknown): string {
  return error instanceof NestboxError ? error.message : 'Something went wrong';
}
```

`src/renderer/state/ui-store.ts`:

```ts
import { create } from 'zustand';

export interface UiData {
  selectedProjectId: string | null;
  /** Active tab per project id; 'overview' when unset. */
  activeTab: Record<string, string>;
  filter: string;
  /** Collapsed workspace groups by root project id. */
  collapsed: Record<string, boolean>;
}

export interface UiState extends UiData {
  select(id: string | null): void;
  setActiveTab(projectId: string, tab: string): void;
  setFilter(filter: string): void;
  toggleCollapsed(projectId: string): void;
}

export const initialUiState: UiData = { selectedProjectId: null, activeTab: {}, filter: '', collapsed: {} };

export const useUiStore = create<UiState>()((set) => ({
  ...initialUiState,
  select: (id) => set({ selectedProjectId: id }),
  setActiveTab: (projectId, tab) => set((s) => ({ activeTab: { ...s.activeTab, [projectId]: tab } })),
  setFilter: (filter) => set({ filter }),
  toggleCollapsed: (projectId) =>
    set((s) => ({ collapsed: { ...s.collapsed, [projectId]: !s.collapsed[projectId] } })),
}));
```

- [ ] **Step 6: Write `src/renderer/lib/queries.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useUiStore } from '@/state/ui-store';
import { api } from './api';
import { errorMessage } from './errors';

export const queryKeys = {
  projects: ['projects'] as const,
  appInfo: ['app-info'] as const,
  tools: (projectId: string) => ['tools', projectId] as const,
  toolCalls: ['tool'] as const,
  tool: (toolId: string, projectId: string, method: string) => ['tool', toolId, projectId, method] as const,
};

const showError = (error: unknown): void => {
  toast.error(errorMessage(error));
};

export function useProjects() {
  return useQuery({ queryKey: queryKeys.projects, queryFn: () => api.projects.list() });
}

export function useAppInfo() {
  return useQuery({ queryKey: queryKeys.appInfo, queryFn: () => api.app.getInfo(), staleTime: Infinity });
}

export function useTools(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.tools(projectId ?? ''),
    queryFn: () => api.tools.list(projectId ?? ''),
    enabled: projectId !== null,
  });
}

function useInvalidateProjects() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.projects });
}

export function useAddProject() {
  const invalidate = useInvalidateProjects();
  const select = useUiStore((s) => s.select);
  return useMutation({
    mutationFn: async () => {
      const path = await api.dialog.pickFolder();
      return path === null ? null : api.projects.add(path);
    },
    onSuccess: async (added) => {
      if (!added) return;
      select(added.id);
      await invalidate();
    },
    onError: showError,
  });
}

export function useRemoveProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.projects.remove(id),
    onSuccess: async (_data, id) => {
      const { selectedProjectId, select } = useUiStore.getState();
      if (selectedProjectId && (selectedProjectId === id || selectedProjectId.startsWith(`${id}::`))) select(null);
      await invalidate();
    },
    onError: showError,
  });
}

export function useRenameProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.projects.rename(id, name),
    onSuccess: () => invalidate(),
    onError: showError,
  });
}

export function useSetPinned() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api.projects.setPinned(id, pinned),
    onSuccess: () => invalidate(),
    onError: showError,
  });
}

export function useRefreshProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.projects.refresh(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: ['tools'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.toolCalls }),
      ]);
    },
    onError: showError,
  });
}

export function useOpenInEditor() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.projects.openInEditor(id),
    onError: async (error) => {
      showError(error);
      await invalidate();
    },
  });
}

export function useOpenTerminal() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.projects.openTerminal(id),
    onError: async (error) => {
      showError(error);
      await invalidate();
    },
  });
}

/** Main pushes projects:changed after any project mutation or refresh. */
export function useProjectsChangedSubscription(): void {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      api.on('projects:changed', () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.projects });
      }),
    [queryClient],
  );
}
```

- [ ] **Step 7: Write `src/renderer/components/NestboxMark.tsx`.** The mark is imported from the brand SVG, never redrawn.

```tsx
import Mark from '@brand/svg/nestbox-mark.svg?react';
import { cn } from '@/lib/utils';

/** The Nestbox mark (resources/brand/svg/nestbox-mark.svg), recoloured to theme tokens. */
export function NestboxMark({ className }: { className?: string }) {
  return <Mark aria-hidden className={cn('[&_#hole]:fill-brand [&_#mark]:fill-fg', className)} />;
}
```

- [ ] **Step 8: Write the test harness**

`src/renderer/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { initialUiState, useUiStore } from '@/state/ui-store';

// jsdom gaps that Radix primitives touch.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

afterEach(() => {
  cleanup();
  useUiStore.setState(initialUiState);
});
```

`src/renderer/test/mock-bridge.ts`:

```ts
import type { NestboxBridge } from '@shared/bridge';
import type { ChannelInput, ChannelOutput } from '@shared/channels';
import { type IpcEnvelope, NestboxError } from '@shared/errors';
import type { EventChannel, InvokeChannel } from '@shared/ipc-names';

export type MockHandlers = {
  [C in InvokeChannel]?: (input: ChannelInput<C>) => ChannelOutput<C> | Promise<ChannelOutput<C>>;
};

export interface MockBridge {
  calls: { channel: InvokeChannel; input: unknown }[];
  callsTo(channel: InvokeChannel): unknown[];
  emit(event: EventChannel, payload?: unknown): void;
}

export function installMockBridge(handlers: MockHandlers): MockBridge {
  const calls: MockBridge['calls'] = [];
  const listeners = new Map<EventChannel, Set<(payload: unknown) => void>>();

  const invoke = async (channel: InvokeChannel, input?: unknown): Promise<IpcEnvelope<unknown>> => {
    calls.push({ channel, input });
    const handler = handlers[channel] as ((i: unknown) => unknown) | undefined;
    if (!handler) return { ok: false, error: { code: 'NOT_FOUND', message: `No mock for ${channel}` } };
    try {
      return { ok: true, data: await handler(input) };
    } catch (error) {
      if (error instanceof NestboxError) return { ok: false, error: { code: error.code, message: error.message } };
      throw error;
    }
  };

  const bridge: NestboxBridge = {
    invoke: invoke as unknown as NestboxBridge['invoke'],
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    },
  };
  window.nestbox = bridge;

  return {
    calls,
    callsTo: (channel) => calls.filter((c) => c.channel === channel).map((c) => c.input),
    emit: (event, payload) => listeners.get(event)?.forEach((l) => l(payload)),
  };
}
```

`src/renderer/test/fixtures.ts`:

```ts
import type { DetectedProject, ProjectSummary } from '@shared/detected';

export function makeDetected(over: Partial<DetectedProject> = {}): DetectedProject {
  return {
    id: 'p1',
    rootId: 'p1',
    path: 'C:\\Dev\\Shop',
    relPath: '',
    name: 'shop',
    missing: false,
    packageJson: { name: 'shop', scripts: { dev: 'vite', build: 'vite build' } },
    packageManager: 'pnpm',
    envFiles: ['.env', '.env.example'],
    workspaces: [],
    prismaSchema: null,
    dockerCompose: null,
    git: { branch: 'main', head: null },
    buildOutput: null,
    claude: { claudeMd: true, claudeLocalMd: false, claudeDir: true, mcpJson: false },
    ...over,
  };
}

export function makeSummary(over: Partial<ProjectSummary> = {}): ProjectSummary {
  const detected = over.detected ?? makeDetected({ id: over.id ?? 'p1', rootId: over.id ?? 'p1', name: over.name ?? 'shop' });
  return {
    id: detected.id,
    name: detected.name,
    path: detected.path,
    pinned: false,
    tags: [],
    ...over,
    detected,
  };
}
```

`src/renderer/test/render.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Toaster } from 'sonner';

export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        {ui}
        <Toaster />
      </QueryClientProvider>,
    ),
  };
}
```

- [ ] **Step 9: Write the failing tests**

`src/renderer/state/ui-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { useUiStore } from './ui-store';

describe('ui store', () => {
  it('tracks selection, tabs per project, filter and collapsed groups', () => {
    const s = useUiStore.getState();
    s.select('p1');
    s.setActiveTab('p1', 'project-info');
    s.setFilter('sho');
    s.toggleCollapsed('p1');
    expect(useUiStore.getState()).toMatchObject({
      selectedProjectId: 'p1',
      activeTab: { p1: 'project-info' },
      filter: 'sho',
      collapsed: { p1: true },
    });
    useUiStore.getState().toggleCollapsed('p1');
    expect(useUiStore.getState().collapsed['p1']).toBe(false);
  });
});
```

`src/renderer/lib/queries.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NestboxError } from '@shared/errors';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge } from '@/test/mock-bridge';
import { makeSummary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { useAddProject } from './queries';

function AddButton() {
  const add = useAddProject();
  return (
    <button type="button" onClick={() => add.mutate()}>
      add
    </button>
  );
}

describe('useAddProject', () => {
  it('picks a folder, adds it and selects the new project', async () => {
    const bridge = installMockBridge({
      'dialog:pickFolder': () => 'C:\\Dev\\Shop',
      'projects:add': ({ path }) => makeSummary({ id: 'new', path }),
    });
    renderWithProviders(<AddButton />);
    await userEvent.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => expect(useUiStore.getState().selectedProjectId).toBe('new'));
    expect(bridge.callsTo('projects:add')).toEqual([{ path: 'C:\\Dev\\Shop' }]);
  });

  it('does nothing when the picker is cancelled', async () => {
    const bridge = installMockBridge({ 'dialog:pickFolder': () => null });
    renderWithProviders(<AddButton />);
    await userEvent.click(screen.getByRole('button', { name: 'add' }));
    await waitFor(() => expect(bridge.callsTo('dialog:pickFolder')).toHaveLength(1));
    expect(bridge.callsTo('projects:add')).toEqual([]);
  });

  it('shows the conflict message as a toast', async () => {
    installMockBridge({
      'dialog:pickFolder': () => 'c:\\dev\\shop',
      'projects:add': () => {
        throw new NestboxError('CONFLICT', 'This folder is already added as "shop"');
      },
    });
    renderWithProviders(<AddButton />);
    await userEvent.click(screen.getByRole('button', { name: 'add' }));
    expect(await screen.findByText('This folder is already added as "shop"')).toBeInTheDocument();
  });
});
```

- [ ] **Step 10: Run the tests and confirm they pass** (you watched them fail right after Step 4).

Run: `pnpm vitest run --project renderer`
Expected: both files pass. If one fails, fix the implementation, not the test.

- [ ] **Step 11: Replace `src/renderer/main.tsx`.** `App` arrives in Task 15; for now, render the mark so the build proves fonts, tokens and svgr work.

```tsx
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NestboxMark } from './components/NestboxMark';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <div className="flex h-full items-center justify-center gap-3 bg-app">
      <NestboxMark className="size-10" />
      <span className="font-mono text-fg">nestbox</span>
    </div>
  </StrictMode>,
);
```

- [ ] **Step 12: Full checks, then a build that shows the fonts are bundled locally**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: everything passes. `ls out/renderer/assets | grep -i woff2` lists the Inter and JetBrains Mono files, and `grep -rn "fonts.googleapis\|https://" out/renderer/assets/*.css` finds nothing.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(renderer): add design tokens, local fonts, shadcn/ui, data hooks and test harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: App shell: title bar, sidebar, status bar and empty state

**Files:**
- Create: `src/renderer/app/find-project.ts`, `src/renderer/app/App.tsx`, `src/renderer/app/TitleBar.tsx`, `src/renderer/app/Sidebar.tsx`, `src/renderer/app/StatusBar.tsx`, `src/renderer/app/EmptyState.tsx`, `src/renderer/app/ProjectView.tsx` (minimal; Task 16 replaces it)
- Modify: `src/renderer/main.tsx`
- Test: `src/renderer/app/find-project.test.ts`, `src/renderer/app/App.test.tsx`, `src/renderer/app/Sidebar.test.tsx`

**Interfaces:**
- Consumes: Task 14's hooks, store, `NestboxMark`, shadcn `Button`/`Input` and test helpers.
- Produces:
  - **`find-project.ts`:**
    - `interface ProjectNode { summary: ProjectSummary; detected: DetectedProject; isWorkspace: boolean }`
    - `findProjectNode(projects, id): ProjectNode | null`
    - `filterProjects(projects, filter): ProjectSummary[]`
  - **Components:** `<App />`, `<Sidebar projects selectedId />`, `<TitleBar node />`, `<StatusBar projectCount />`, `<EmptyState />`, `<ProjectView node />`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/app/find-project.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeDetected, makeSummary } from '@/test/fixtures';
import { filterProjects, findProjectNode } from './find-project';

const api = makeDetected({ id: 'p1::packages/api', relPath: 'packages/api', name: '@mono/api' });
const mono = makeSummary({ id: 'p1', name: 'mono', detected: makeDetected({ id: 'p1', name: 'mono', workspaces: [api] }) });
const shop = makeSummary({ id: 'p2', name: 'shop', detected: makeDetected({ id: 'p2', rootId: 'p2', name: 'shop' }) });

describe('findProjectNode', () => {
  it('finds roots and workspaces', () => {
    expect(findProjectNode([mono, shop], 'p2')).toMatchObject({ isWorkspace: false, detected: { name: 'shop' } });
    expect(findProjectNode([mono, shop], 'p1::packages/api')).toMatchObject({
      isWorkspace: true,
      summary: { id: 'p1' },
      detected: { name: '@mono/api' },
    });
    expect(findProjectNode([mono], 'nope')).toBeNull();
    expect(findProjectNode([mono], null)).toBeNull();
  });
});

describe('filterProjects', () => {
  it('matches root or workspace names case-insensitively', () => {
    expect(filterProjects([mono, shop], '')).toEqual([mono, shop]);
    expect(filterProjects([mono, shop], 'SHO')).toEqual([shop]);
    expect(filterProjects([mono, shop], 'api')).toEqual([mono]);
  });
});
```

`src/renderer/app/App.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ProjectSummary } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { installMockBridge } from '@/test/mock-bridge';
import { makeSummary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { App } from './App';

const baseHandlers = {
  'app:getInfo': () => ({ version: '0.0.0', platform: 'win32' as const }),
  'tools:list': () => [],
};

describe('App shell', () => {
  it('shows the empty state and a zero count without projects', async () => {
    installMockBridge({ ...baseHandlers, 'projects:list': () => [] });
    renderWithProviders(<App />);
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getByText('0 projects')).toBeInTheDocument();
    expect(await screen.findByText('v0.0.0')).toBeInTheDocument();
  });

  it('adds a project from the empty state and selects it', async () => {
    let projects: ProjectSummary[] = [];
    installMockBridge({
      ...baseHandlers,
      'projects:list': () => projects,
      'dialog:pickFolder': () => 'C:\\Dev\\Shop',
      'projects:add': () => {
        projects = [makeSummary()];
        return projects[0] as ProjectSummary;
      },
    });
    renderWithProviders(<App />);
    const main = await screen.findByRole('main');
    await userEvent.click(within(main).getByRole('button', { name: /add project/i }));
    expect(await within(main).findByRole('heading', { name: 'shop' })).toBeInTheDocument();
    expect(within(screen.getByRole('complementary', { name: 'Projects' })).getByRole('button', { name: 'shop' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('1 project')).toBeInTheDocument();
  });

  it('shows a toast when the folder is already added', async () => {
    installMockBridge({
      ...baseHandlers,
      'projects:list': () => [],
      'dialog:pickFolder': () => 'c:\\dev\\shop\\',
      'projects:add': () => {
        throw new NestboxError('CONFLICT', 'This folder is already added as "shop"');
      },
    });
    renderWithProviders(<App />);
    const main = await screen.findByRole('main');
    await userEvent.click(within(main).getByRole('button', { name: /add project/i }));
    expect(await screen.findByText('This folder is already added as "shop"')).toBeInTheDocument();
  });

  it('refetches projects when main reports a change', async () => {
    let projects: ProjectSummary[] = [];
    const bridge = installMockBridge({ ...baseHandlers, 'projects:list': () => projects });
    renderWithProviders(<App />);
    await screen.findByRole('heading', { name: 'No projects yet' });
    projects = [makeSummary()];
    bridge.emit('projects:changed');
    await waitFor(() => expect(screen.getByText('1 project')).toBeInTheDocument());
  });
});
```

`src/renderer/app/Sidebar.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge } from '@/test/mock-bridge';
import { makeDetected, makeSummary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { Sidebar } from './Sidebar';

const ws = makeDetected({ id: 'p1::packages/api', rootId: 'p1', relPath: 'packages/api', name: '@mono/api' });
const mono = makeSummary({ id: 'p1', name: 'mono', pinned: true, detected: makeDetected({ id: 'p1', name: 'mono', workspaces: [ws] }) });
const shop = makeSummary({ id: 'p2', name: 'shop', detected: makeDetected({ id: 'p2', rootId: 'p2', name: 'shop' }) });
const gone = makeSummary({ id: 'p3', name: 'gone', detected: makeDetected({ id: 'p3', rootId: 'p3', name: 'gone', missing: true }) });

function renderSidebar(selectedId: string | null = null) {
  installMockBridge({});
  return renderWithProviders(<Sidebar projects={[mono, shop, gone]} selectedId={selectedId} />);
}

describe('Sidebar', () => {
  it('shows a Pinned section only for pinned projects', () => {
    renderSidebar();
    const pinned = screen.getByRole('region', { name: 'Pinned' });
    expect(within(pinned).getByRole('button', { name: 'mono' })).toBeInTheDocument();
    const all = screen.getByRole('region', { name: 'All projects' });
    expect(within(all).getByText('3')).toBeInTheDocument();
    expect(within(all).queryByRole('button', { name: 'mono' })).toBeNull();
  });

  it('has no Pinned section when nothing is pinned', () => {
    installMockBridge({});
    renderWithProviders(<Sidebar projects={[shop]} selectedId={null} />);
    expect(screen.queryByRole('region', { name: 'Pinned' })).toBeNull();
  });

  it('filters by project or workspace name', async () => {
    renderSidebar();
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter projects' }), 'api');
    expect(screen.getByRole('button', { name: 'mono' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'shop' })).toBeNull();
  });

  it('nests workspaces, selects them and collapses the group', async () => {
    renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: '@mono/api' }));
    expect(useUiStore.getState().selectedProjectId).toBe('p1::packages/api');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse mono' }));
    expect(screen.queryByRole('button', { name: '@mono/api' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand mono' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the selected project and missing folders', () => {
    renderSidebar('p2');
    expect(screen.getByRole('button', { name: 'shop' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /gone/ })).toHaveTextContent('missing');
  });
});
```

Note: buttons are named by their visible text. The status dot is `aria-hidden`, and the "missing" label is part of the row's text, which is why the missing row is matched with `/gone/`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run --project renderer src/renderer/app`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/renderer/app/find-project.ts`**

```ts
import { type DetectedProject, findDetected, type ProjectSummary, splitProjectId } from '@shared/detected';

export interface ProjectNode {
  /** The root project (stored fields: pinned, name, …). */
  summary: ProjectSummary;
  /** The selected root or workspace package. */
  detected: DetectedProject;
  isWorkspace: boolean;
}

export function findProjectNode(projects: readonly ProjectSummary[], id: string | null): ProjectNode | null {
  if (!id) return null;
  const summary = projects.find((p) => p.id === splitProjectId(id).rootId);
  const detected = summary ? findDetected(summary.detected, id) : null;
  if (!summary || !detected) return null;
  return { summary, detected, isWorkspace: detected.relPath !== '' };
}

export function filterProjects(projects: readonly ProjectSummary[], filter: string): ProjectSummary[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return [...projects];
  return projects.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      p.detected.workspaces.some((w) => w.name.toLowerCase().includes(needle)),
  );
}
```

- [ ] **Step 4: Implement the shell components**

`src/renderer/app/TitleBar.tsx`:

```tsx
import { NestboxMark } from '@/components/NestboxMark';
import { useAppInfo } from '@/lib/queries';
import type { ProjectNode } from './find-project';

export function TitleBar({ node }: { node: ProjectNode | null }) {
  const { data: info } = useAppInfo();
  const git = node?.detected.git;
  const ref = git?.branch ?? git?.head ?? null;
  return (
    <header
      className="drag flex h-10 shrink-0 items-center border-b border-line bg-card pr-3"
      // Leave room for native window controls (titleBarOverlay on Windows, traffic lights on macOS).
      style={{ paddingLeft: 'max(12px, env(titlebar-area-x, 0px))', width: 'env(titlebar-area-width, 100%)' }}
    >
      <div className="flex items-center gap-2">
        <NestboxMark className="size-4" />
        <span className="text-xs font-bold tracking-wide text-fg">nestbox</span>
        {info && (
          <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-muted">
            v{info.version}
          </span>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-fg-muted">
        {node && <span>{node.detected.name}</span>}
        {node && ref && (
          <>
            <span aria-hidden className="text-fg-faint">
              •
            </span>
            <span className="font-mono text-[11px] text-brand">{ref}</span>
          </>
        )}
      </div>
    </header>
  );
}
```

`src/renderer/app/StatusBar.tsx`:

```tsx
export function StatusBar({ projectCount }: { projectCount: number }) {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-card px-4 font-mono text-[11px] text-fg-muted">
      <span>
        {projectCount} {projectCount === 1 ? 'project' : 'projects'}
      </span>
    </footer>
  );
}
```

`src/renderer/app/EmptyState.tsx`:

```tsx
import { FolderPlus } from 'lucide-react';
import { NestboxMark } from '@/components/NestboxMark';
import { Button } from '@/components/ui/button';
import { useAddProject } from '@/lib/queries';

export function EmptyState() {
  const addProject = useAddProject();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="flex items-center gap-3">
        <NestboxMark className="size-12" />
        <span className="text-3xl font-bold tracking-tight text-fg">nestbox</span>
      </div>
      <div>
        <h1 className="text-base font-semibold text-fg">No projects yet</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Add a project folder to see its scripts, env files and tools in one place.
        </p>
      </div>
      <Button onClick={() => addProject.mutate()} disabled={addProject.isPending}>
        <FolderPlus />
        Add project
      </Button>
    </div>
  );
}
```

`src/renderer/app/Sidebar.tsx`:

```tsx
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAddProject } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/state/ui-store';
import type { DetectedProject, ProjectSummary } from '@shared/detected';
import { filterProjects } from './find-project';

interface SidebarProps {
  projects: ProjectSummary[];
  selectedId: string | null;
}

export function Sidebar({ projects, selectedId }: SidebarProps) {
  const filter = useUiStore((s) => s.filter);
  const setFilter = useUiStore((s) => s.setFilter);
  const addProject = useAddProject();
  const visible = filterProjects(projects, filter);
  const pinned = visible.filter((p) => p.pinned);
  const others = visible.filter((p) => !p.pinned);

  return (
    <aside aria-label="Projects" className="flex w-64 shrink-0 flex-col border-r border-line bg-card">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-2 left-2.5 size-3.5 text-fg-muted" />
          <Input
            aria-label="Filter projects"
            placeholder="Filter projects…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-7 bg-app pl-8 text-xs"
          />
        </div>
        {pinned.length > 0 && (
          <ProjectSection title="Pinned" count={pinned.length} projects={pinned} selectedId={selectedId} />
        )}
        <ProjectSection title="All projects" count={projects.length} projects={others} selectedId={selectedId} />
      </div>
      <div className="border-t border-line p-3">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={addProject.isPending}
          onClick={() => addProject.mutate()}
        >
          <Plus className="size-3.5 text-brand" />
          Add project
        </Button>
      </div>
    </aside>
  );
}

function ProjectSection({ title, count, projects, selectedId }: SidebarProps & { title: string; count: number }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-1.5 flex items-center justify-between px-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
        <span>{title}</span>
        <span className="text-fg-faint">{count}</span>
      </h2>
      <ul className="space-y-0.5">
        {projects.map((project) => (
          <ProjectItem key={project.id} project={project} selectedId={selectedId} />
        ))}
      </ul>
    </section>
  );
}

function ProjectItem({ project, selectedId }: { project: ProjectSummary; selectedId: string | null }) {
  const collapsed = useUiStore((s) => s.collapsed[project.id] ?? false);
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed);
  const workspaces = project.detected.workspaces;
  return (
    <li>
      <div className="flex items-center">
        <ProjectRow detected={project.detected} label={project.name} selected={selectedId === project.id} />
        {workspaces.length > 0 && (
          <button
            type="button"
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${project.name}`}
            aria-expanded={!collapsed}
            onClick={() => toggleCollapsed(project.id)}
            className="rounded p-1 text-fg-faint hover:text-fg"
          >
            {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        )}
      </div>
      {workspaces.length > 0 && !collapsed && (
        <ul className="mt-0.5 ml-4 space-y-0.5 border-l border-line pl-2">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <ProjectRow detected={ws} label={ws.name} selected={selectedId === ws.id} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ProjectRow({ detected, label, selected }: { detected: DetectedProject; label: string; selected: boolean }) {
  const select = useUiStore((s) => s.select);
  return (
    <button
      type="button"
      aria-current={selected ? 'page' : undefined}
      onClick={() => select(detected.id)}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
        selected ? 'border-line bg-surface text-fg' : 'border-transparent text-fg-muted hover:bg-surface/50 hover:text-fg',
        detected.missing && 'opacity-60',
      )}
    >
      {/* M1: dot colour reflects process state (running/starting/crashed). */}
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-idle" />
      <span className="truncate">{label}</span>
      {detected.missing && <span className="ml-auto text-[10px] text-err">missing</span>}
    </button>
  );
}
```

`src/renderer/app/ProjectView.tsx` (minimal; Task 16 replaces it):

```tsx
import type { ProjectNode } from './find-project';

export function ProjectView({ node }: { node: ProjectNode }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-fg">{node.detected.name}</h1>
    </div>
  );
}
```

`src/renderer/app/App.tsx`:

```tsx
import { useProjects, useProjectsChangedSubscription } from '@/lib/queries';
import { useUiStore } from '@/state/ui-store';
import { EmptyState } from './EmptyState';
import { findProjectNode } from './find-project';
import { ProjectView } from './ProjectView';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

export function App() {
  useProjectsChangedSubscription();
  const { data: projects = [], isPending } = useProjects();
  const selectedId = useUiStore((s) => s.selectedProjectId);
  const node = findProjectNode(projects, selectedId) ?? findProjectNode(projects, projects[0]?.id ?? null);

  return (
    <div className="flex h-full flex-col bg-app text-fg">
      <TitleBar node={node} />
      <div className="flex min-h-0 flex-1">
        <Sidebar projects={projects} selectedId={node?.detected.id ?? null} />
        <main className="flex min-w-0 flex-1 flex-col">
          {isPending ? null : node ? <ProjectView key={node.detected.id} node={node} /> : <EmptyState />}
        </main>
      </div>
      <StatusBar projectCount={projects.length} />
    </div>
  );
}
```

`src/renderer/main.tsx` (replace the body):

```tsx
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/globals.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { App } from './app/App';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster theme="dark" position="bottom-right" />
    </QueryClientProvider>
  </StrictMode>,
);
```

The `<Toaster />` lives next to the providers: in `main.tsx` in production and in `renderWithProviders` in tests. `App` never renders one, so tests never see two copies of a toast.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm vitest run --project renderer && pnpm lint && pnpm typecheck`
Expected: all tests pass, and lint is clean, including the hex-literal rule.

- [ ] **Step 6: Smoke-run the app**

Run: `pnpm dev`. Expected:
- The title bar shows the mark, "nestbox" and the version, with the native caption buttons on the right.
- The empty state is centred.
- "Add project" opens the folder picker. Picking a folder adds it to the sidebar.
- Restarting `pnpm dev` keeps the project.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "feat(renderer): add app shell with title bar, project sidebar, status bar and empty state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Project view: header actions, tool tabs, Overview grid and the Project info renderer half

**Files:**
- Create: `src/renderer/tools/types.ts`, `src/renderer/tools/icons.ts`, `src/renderer/tools/registry.ts`, `src/renderer/tools/project-info/use-facts.ts`, `src/renderer/tools/project-info/OverviewCard.tsx`, `src/renderer/tools/project-info/Panel.tsx`, `src/renderer/tools/project-info/index.ts`, `src/renderer/app/ProjectHeader.tsx`, `src/renderer/app/RenameInput.tsx`, `src/renderer/app/ToolTabs.tsx`, `src/renderer/app/OverviewGrid.tsx`
- Modify: `src/renderer/app/ProjectView.tsx` (replace)
- Test: `src/renderer/app/ProjectView.test.tsx`, `src/renderer/tools/icons.test.ts`

**Interfaces:**
- Consumes: Task 14 hooks; `ProjectNode` (Task 15); `api.tools.invoke`; the shadcn `Button`, `Badge`, `DropdownMenu*` and `AlertDialog*`.
- Produces:
  - **Tool types:** `RendererTool { id: string; Panel: ToolComponent; OverviewCard?: ToolComponent }`, where `ToolComponent = ComponentType<{ projectId: string }> | LazyExoticComponent<ComponentType<{ projectId: string }>>`.
  - **Registry:** `rendererTools` and `getRendererTool(id)`.
  - **Icons:** `toolIcon(name: string): LucideIcon` (`Box` for unknown names).
  - **Project info:** `useProjectFacts(projectId)`.
  - **Components:** `<ProjectView node />`.

- [ ] **Step 1: Write the failing tests**

`src/renderer/tools/icons.test.ts`:

```ts
import { Box, Info, LayoutGrid } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { toolDefinitions } from '@shared/tools';
import { toolIcon } from './icons';

describe('toolIcon', () => {
  it('maps known names and falls back to Box', () => {
    expect(toolIcon('info')).toBe(Info);
    expect(toolIcon('layout-grid')).toBe(LayoutGrid);
    expect(toolIcon('nope')).toBe(Box);
  });

  it('has an icon for every registered tool', () => {
    for (const def of toolDefinitions) expect(toolIcon(def.icon)).not.toBe(Box);
  });
});
```

`src/renderer/app/ProjectView.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DetectedProject, ProjectSummary } from '@shared/detected';
import { NestboxError } from '@shared/errors';
import { useUiStore } from '@/state/ui-store';
import { installMockBridge, type MockHandlers } from '@/test/mock-bridge';
import { makeDetected, makeSummary } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { App } from './App';

const ws = makeDetected({ id: 'p1::packages/api', rootId: 'p1', relPath: 'packages/api', name: '@shop/api', path: 'C:\\Dev\\Shop\\packages\\api', git: null });
const root = makeDetected({ id: 'p1', name: 'shop', workspaces: [ws], git: { branch: 'feature/m0', head: null } });

function setup(over: MockHandlers = {}, project: ProjectSummary = makeSummary({ id: 'p1', name: 'shop', detected: root })) {
  const bridge = installMockBridge({
    'app:getInfo': () => ({ version: '0.0.0', platform: 'win32' }),
    'projects:list': () => [project],
    'tools:list': () => [{ id: 'project-info', name: 'Project info', icon: 'info' }],
    'tools:invoke': ({ projectId }) => (projectId === ws.id ? ws : root) satisfies DetectedProject,
    'projects:openInEditor': () => undefined,
    'projects:openTerminal': () => undefined,
    'projects:rename': ({ name }) => makeSummary({ id: 'p1', name, detected: { ...root, name } }),
    'projects:remove': () => undefined,
    'projects:setPinned': ({ pinned }) => ({ ...project, pinned }),
    'projects:refresh': () => project,
    ...over,
  });
  renderWithProviders(<App />);
  return bridge;
}

async function openMenu() {
  await userEvent.click(await screen.findByRole('button', { name: 'Project actions' }));
}

describe('project header', () => {
  it('shows name, path, package manager and branch', async () => {
    setup();
    const main = await screen.findByRole('main');
    expect(await within(main).findByRole('heading', { name: 'shop' })).toBeInTheDocument();
    expect(within(main).getByText('C:\\Dev\\Shop')).toBeInTheDocument();
    // 'pnpm' also appears on the Overview card once it loads
    expect(within(main).getAllByText('pnpm').length).toBeGreaterThan(0);
    expect(within(main).getByText('feature/m0')).toBeInTheDocument();
  });

  it('opens the editor and terminal for the selected project', async () => {
    const bridge = setup();
    await userEvent.click(await screen.findByRole('button', { name: /open in vs code/i }));
    await userEvent.click(screen.getByRole('button', { name: /open terminal here/i }));
    await waitFor(() => expect(bridge.callsTo('projects:openTerminal')).toEqual([{ id: 'p1' }]));
    expect(bridge.callsTo('projects:openInEditor')).toEqual([{ id: 'p1' }]);
  });

  it('shows a toast when the folder vanished', async () => {
    setup({
      'projects:openInEditor': () => {
        throw new NestboxError('NOT_FOUND', 'The project folder no longer exists');
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /open in vs code/i }));
    expect(await screen.findByText('The project folder no longer exists')).toBeInTheDocument();
  });

  it('renames inline: Enter saves the trimmed name, Escape cancels', async () => {
    const bridge = setup();
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const input = await screen.findByRole('textbox', { name: 'Project name' });
    await userEvent.clear(input);
    await userEvent.type(input, '  Shop Backend  {Enter}');
    await waitFor(() => expect(bridge.callsTo('projects:rename')).toEqual([{ id: 'p1', name: 'Shop Backend' }]));

    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    await userEvent.type(await screen.findByRole('textbox', { name: 'Project name' }), 'x{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Project name' })).toBeNull();
    expect(bridge.callsTo('projects:rename')).toHaveLength(1);
  });

  it('removes only after confirming', async () => {
    const bridge = setup();
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/folder on disk is not touched/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(bridge.callsTo('projects:remove')).toEqual([]);

    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(bridge.callsTo('projects:remove')).toEqual([{ id: 'p1' }]));
  });

  it('pins from the menu', async () => {
    const bridge = setup();
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pin' }));
    await waitFor(() => expect(bridge.callsTo('projects:setPinned')).toEqual([{ id: 'p1', pinned: true }]));
  });

  it('offers only Refresh for a workspace package', async () => {
    useUiStore.getState().select('p1::packages/api');
    const bridge = setup();
    const main = await screen.findByRole('main');
    expect(await within(main).findByRole('heading', { name: '@shop/api' })).toBeInTheDocument();
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh' }));
    await waitFor(() => expect(bridge.callsTo('projects:refresh')).toEqual([{ id: 'p1::packages/api' }]));
  });
});

describe('tabs and tools', () => {
  it('shows the Overview tab with the Project info card first', async () => {
    setup();
    const tab = await screen.findByRole('tab', { name: 'Overview' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    const card = await screen.findByRole('region', { name: 'Project info' });
    expect(within(card).getByText('pnpm')).toBeInTheDocument();
    expect(within(card).getByText('2 scripts')).toBeInTheDocument();
  });

  it('switches to the Project info panel', async () => {
    setup();
    await userEvent.click(await screen.findByRole('tab', { name: 'Project info' }));
    expect(await screen.findByRole('heading', { name: 'Scripts' })).toBeInTheDocument();
    expect(screen.getByText('vite build')).toBeInTheDocument();
    expect(screen.getByText('.env.example')).toBeInTheDocument();
    expect(useUiStore.getState().activeTab['p1']).toBe('project-info');
  });

  it('hides tools and disables actions for a missing folder', async () => {
    setup({}, makeSummary({ id: 'p1', name: 'shop', detected: { ...root, missing: true, workspaces: [] } }));
    expect(await screen.findByText(/folder no longer exists/i)).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('button', { name: /open in vs code/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm vitest run --project renderer src/renderer/app/ProjectView.test.tsx src/renderer/tools`
Expected: FAIL. The modules don't exist yet, and the minimal `ProjectView` has no header.

- [ ] **Step 3: Implement the renderer tool registry**

`src/renderer/tools/types.ts`:

```ts
import type { ComponentType, LazyExoticComponent } from 'react';

export interface ToolPanelProps {
  projectId: string;
}

export type ToolComponent = ComponentType<ToolPanelProps> | LazyExoticComponent<ComponentType<ToolPanelProps>>;

/** Renderer half of a tool; `id` matches the shared ToolDefinition. */
export interface RendererTool {
  id: string;
  Panel: ToolComponent;
  OverviewCard?: ToolComponent;
}
```

`src/renderer/tools/icons.ts`:

```ts
import { Box, Info, LayoutGrid, type LucideIcon } from 'lucide-react';

/** lucide icon names used by ToolDefinition.icon. Adding a tool with a new icon adds a line here. */
const ICONS: Record<string, LucideIcon> = {
  info: Info,
  'layout-grid': LayoutGrid,
};

export function toolIcon(name: string): LucideIcon {
  return ICONS[name] ?? Box;
}
```

`src/renderer/tools/project-info/use-facts.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/queries';

export function useProjectFacts(projectId: string) {
  return useQuery({
    queryKey: queryKeys.tool('project-info', projectId, 'getFacts'),
    queryFn: () => api.tools.invoke('project-info', projectId, 'getFacts', {}),
  });
}
```

`src/renderer/tools/project-info/OverviewCard.tsx`:

```tsx
import type { ToolPanelProps } from '../types';
import { useProjectFacts } from './use-facts';

export function ProjectInfoCard({ projectId }: ToolPanelProps) {
  const { data } = useProjectFacts(projectId);
  const scripts = data ? Object.keys(data.packageJson?.scripts ?? {}).length : 0;
  const claudeFiles = data ? Object.values(data.claude).filter(Boolean).length : 0;
  return (
    <section aria-label="Project info" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Project</h3>
      {data && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-fg-muted">Package manager</dt>
          <dd className="font-mono text-fg">{data.packageManager ?? 'none'}</dd>
          <dt className="text-fg-muted">Scripts</dt>
          <dd className="text-fg">{scripts} scripts</dd>
          <dt className="text-fg-muted">Env files</dt>
          <dd className="text-fg">{data.envFiles.length}</dd>
          <dt className="text-fg-muted">Workspaces</dt>
          <dd className="text-fg">{data.workspaces.length}</dd>
          <dt className="text-fg-muted">Claude Code</dt>
          <dd className="text-fg">{claudeFiles} of 4 files</dd>
        </dl>
      )}
    </section>
  );
}
```

`src/renderer/tools/project-info/Panel.tsx`:

```tsx
import type { ReactNode } from 'react';
import type { ToolPanelProps } from '../types';
import { useProjectFacts } from './use-facts';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-xs text-fg-faint">{children}</p>;
}

export default function ProjectInfoPanel({ projectId }: ToolPanelProps) {
  const { data, isPending } = useProjectFacts(projectId);
  if (isPending || !data) return null;
  const scripts = Object.entries(data.packageJson?.scripts ?? {});
  const yesNo = (v: boolean) => (v ? 'yes' : 'no');

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Scripts">
        {scripts.length === 0 ? (
          <Empty>No scripts in package.json.</Empty>
        ) : (
          <ul className="space-y-1.5 font-mono text-xs">
            {scripts.map(([name, command]) => (
              <li key={name} className="flex gap-3">
                <span className="w-28 shrink-0 truncate text-fg">{name}</span>
                <span className="truncate text-fg-muted">{command}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Env files">
        {data.envFiles.length === 0 ? (
          <Empty>No .env files.</Empty>
        ) : (
          <ul className="space-y-1 font-mono text-xs text-fg">
            {data.envFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Stack">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-fg-muted">Package manager</dt>
          <dd className="font-mono text-fg">{data.packageManager ?? 'none'}</dd>
          <dt className="text-fg-muted">Prisma schema</dt>
          <dd className="font-mono text-fg">{data.prismaSchema ?? 'none'}</dd>
          <dt className="text-fg-muted">Docker Compose</dt>
          <dd className="font-mono text-fg">{data.dockerCompose ?? 'none'}</dd>
          <dt className="text-fg-muted">Build output</dt>
          <dd className="font-mono text-fg">{data.buildOutput ?? 'none'}</dd>
          <dt className="text-fg-muted">Git</dt>
          <dd className="font-mono text-fg">
            {data.git ? (data.git.branch ?? data.git.head ?? 'unknown') : 'not a repository'}
          </dd>
        </dl>
      </Section>
      <Section title="Claude Code">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="font-mono text-fg-muted">CLAUDE.md</dt>
          <dd className="text-fg">{yesNo(data.claude.claudeMd)}</dd>
          <dt className="font-mono text-fg-muted">CLAUDE.local.md</dt>
          <dd className="text-fg">{yesNo(data.claude.claudeLocalMd)}</dd>
          <dt className="font-mono text-fg-muted">.claude/</dt>
          <dd className="text-fg">{yesNo(data.claude.claudeDir)}</dd>
          <dt className="font-mono text-fg-muted">.mcp.json</dt>
          <dd className="text-fg">{yesNo(data.claude.mcpJson)}</dd>
        </dl>
      </Section>
      {data.workspaces.length > 0 && (
        <Section title="Workspaces">
          <ul className="space-y-1.5 text-xs">
            {data.workspaces.map((w) => (
              <li key={w.id} className="flex gap-3">
                <span className="text-fg">{w.name}</span>
                <span className="font-mono text-fg-muted">{w.relPath}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
```

`src/renderer/tools/project-info/index.ts`:

```ts
import { lazy } from 'react';
import type { RendererTool } from '../types';
import { ProjectInfoCard } from './OverviewCard';

export const projectInfoRendererTool: RendererTool = {
  id: 'project-info',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: ProjectInfoCard,
};
```

`src/renderer/tools/registry.ts`:

```ts
import { projectInfoRendererTool } from './project-info';
import type { RendererTool } from './types';

/** Tool registry, renderer half. */
export const rendererTools: readonly RendererTool[] = [projectInfoRendererTool];

export function getRendererTool(id: string): RendererTool | undefined {
  return rendererTools.find((tool) => tool.id === id);
}
```

- [ ] **Step 4: Implement the view components**

`src/renderer/app/RenameInput.tsx`:

```tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';

interface RenameInputProps {
  initial: string;
  onSubmit(name: string): void;
  onCancel(): void;
}

export function RenameInput({ initial, onSubmit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  return (
    <Input
      aria-label="Project name"
      autoFocus
      value={value}
      maxLength={100}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const name = value.trim();
          if (name && name !== initial) onSubmit(name);
          else onCancel();
        }
      }}
      className="h-8 max-w-sm text-lg font-bold"
    />
  );
}
```

`src/renderer/app/ProjectHeader.tsx`:

```tsx
import { ExternalLink, Folder, GitBranch, MoreHorizontal, SquareTerminal } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useOpenInEditor,
  useOpenTerminal,
  useRefreshProject,
  useRemoveProject,
  useRenameProject,
  useSetPinned,
} from '@/lib/queries';
import type { ProjectNode } from './find-project';
import { RenameInput } from './RenameInput';

export function ProjectHeader({ node }: { node: ProjectNode }) {
  const { detected, summary, isWorkspace } = node;
  const [renaming, setRenaming] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const keepFocus = useRef(false);
  const openInEditor = useOpenInEditor();
  const openTerminal = useOpenTerminal();
  const refresh = useRefreshProject();
  const rename = useRenameProject();
  const remove = useRemoveProject();
  const setPinned = useSetPinned();
  const ref = detected.git?.branch ?? detected.git?.head ?? null;

  return (
    <div className="border-b border-line bg-card/40 px-5 pt-5 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-3">
            {renaming ? (
              <RenameInput
                initial={summary.name}
                onSubmit={(name) => {
                  rename.mutate({ id: summary.id, name });
                  setRenaming(false);
                }}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <h1 className="truncate text-xl font-bold tracking-tight text-fg">{detected.name}</h1>
            )}
            {detected.missing && (
              <Badge variant="outline" className="border-err/30 bg-err/10 text-err">
                missing
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 font-mono text-xs text-fg-muted">
            <span className="flex min-w-0 items-center gap-1">
              <Folder aria-hidden className="size-3.5 shrink-0 text-fg-faint" />
              <span className="truncate">{detected.path}</span>
            </span>
            {detected.packageManager && (
              <span className="rounded border border-line bg-surface px-1.5 py-0.5 text-fg">
                {detected.packageManager}
              </span>
            )}
            {ref && (
              <span className="flex items-center gap-1 text-brand">
                <GitBranch aria-hidden className="size-3.5" />
                {ref}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={detected.missing || openInEditor.isPending}
            onClick={() => openInEditor.mutate(detected.id)}
          >
            <ExternalLink className="text-brand" />
            Open in VS Code
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={detected.missing || openTerminal.isPending}
            onClick={() => openTerminal.mutate(detected.id)}
          >
            <SquareTerminal className="text-brand" />
            Open terminal here
          </Button>
          {/* modal={false}: opening the AlertDialog from a menu item must not leave pointer-events locked. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Project actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(e) => {
                if (keepFocus.current) {
                  e.preventDefault();
                  keepFocus.current = false;
                }
              }}
            >
              <DropdownMenuItem onSelect={() => refresh.mutate(detected.id)}>Refresh</DropdownMenuItem>
              {!isWorkspace && (
                <>
                  <DropdownMenuItem onSelect={() => setPinned.mutate({ id: summary.id, pinned: !summary.pinned })}>
                    {summary.pinned ? 'Unpin' : 'Pin'}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      keepFocus.current = true;
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => {
                      keepFocus.current = true;
                      setConfirmRemove(true);
                    }}
                  >
                    Remove
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove “{summary.name}” from Nestbox?</AlertDialogTitle>
            <AlertDialogDescription>
              Nestbox forgets this project and its settings. The folder on disk is not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-err text-fg hover:bg-err/90"
              onClick={() => remove.mutate(summary.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

`src/renderer/app/ToolTabs.tsx`:

```tsx
import type { ToolSummary } from '@shared/tool';
import { cn } from '@/lib/utils';
import { toolIcon } from '@/tools/icons';

export const OVERVIEW_TAB = 'overview';

interface ToolTabsProps {
  tools: ToolSummary[];
  active: string;
  onSelect(tab: string): void;
}

export function ToolTabs({ tools, active, onSelect }: ToolTabsProps) {
  const tabs: ToolSummary[] = [{ id: OVERVIEW_TAB, name: 'Overview', icon: 'layout-grid' }, ...tools];
  return (
    <div role="tablist" aria-label="Project tools" className="flex gap-1 border-b border-line px-5">
      {tabs.map((tab) => {
        const Icon = toolIcon(tab.icon);
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2 text-xs font-medium transition-colors',
              selected ? 'border-brand text-brand' : 'border-transparent text-fg-muted hover:border-line hover:text-fg',
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
```

`src/renderer/app/OverviewGrid.tsx`:

```tsx
import { Suspense } from 'react';
import type { ToolSummary } from '@shared/tool';
import { getRendererTool } from '@/tools/registry';

export function OverviewGrid({ projectId, tools }: { projectId: string; tools: ToolSummary[] }) {
  const cards = tools.flatMap((tool) => {
    const Card = getRendererTool(tool.id)?.OverviewCard;
    return Card ? [{ id: tool.id, Card }] : [];
  });
  if (cards.length === 0) return <p className="text-sm text-fg-muted">No overview cards for this project yet.</p>;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Suspense fallback={null}>
        {cards.map(({ id, Card }) => (
          <Card key={id} projectId={projectId} />
        ))}
      </Suspense>
    </div>
  );
}
```

`src/renderer/app/ProjectView.tsx` (replace):

```tsx
import { Suspense } from 'react';
import { useTools } from '@/lib/queries';
import { useUiStore } from '@/state/ui-store';
import { getRendererTool } from '@/tools/registry';
import type { ProjectNode } from './find-project';
import { OverviewGrid } from './OverviewGrid';
import { ProjectHeader } from './ProjectHeader';
import { OVERVIEW_TAB, ToolTabs } from './ToolTabs';

export function ProjectView({ node }: { node: ProjectNode }) {
  const projectId = node.detected.id;
  const missing = node.detected.missing;
  const { data: tools = [] } = useTools(missing ? null : projectId);
  const stored = useUiStore((s) => s.activeTab[projectId]);
  const setActiveTab = useUiStore((s) => s.setActiveTab);
  const active = stored && tools.some((t) => t.id === stored) ? stored : OVERVIEW_TAB;
  const Panel = active === OVERVIEW_TAB ? undefined : getRendererTool(active)?.Panel;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ProjectHeader node={node} />
      {!missing && <ToolTabs tools={tools} active={active} onSelect={(tab) => setActiveTab(projectId, tab)} />}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {missing ? (
          <p className="text-sm text-fg-muted">
            The project folder no longer exists at <span className="font-mono text-fg">{node.detected.path}</span>.
            Restore it and choose Refresh, or remove the project.
          </p>
        ) : Panel ? (
          <Suspense fallback={null}>
            <Panel projectId={projectId} />
          </Suspense>
        ) : (
          <OverviewGrid projectId={projectId} tools={tools} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm vitest run --project renderer && pnpm lint && pnpm typecheck`
Expected: all tests pass.

If Radix-in-jsdom problems appear (for example the menu not opening), check that the Task 14 setup polyfills are loaded before changing component code. Use superpowers:systematic-debugging.

- [ ] **Step 6: Smoke-run the app**

Run: `pnpm dev`, then add a real pnpm monorepo. Expected:
- Workspaces are nested in the sidebar.
- The header shows the path in its original casing, `pnpm` and the branch.
- The Overview shows the Project info card, and the Project info tab lists scripts and env file names.
- "Open in VS Code" and "Open terminal here" work, including for a folder whose path contains a space and an `&`.
- Rename, Pin and Remove all work.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "feat(renderer): add project header actions, tool tabs, overview grid and Project info tool UI

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: CLAUDE.md, packaging config and final verification

**Files:**
- Create: `CLAUDE.md`, `electron-builder.yml`
- Modify: `README.md` (add the "Development" section)

- [ ] **Step 1: Write `electron-builder.yml`.** The installer build itself is M3; this file pins icon and asset paths now.

```yaml
appId: dev.nestbox.app
productName: Nestbox
directories:
  buildResources: resources
  output: release/${version}
files:
  - out/**/*
  - package.json
extraResources:
  - from: resources/brand
    to: brand
win:
  target: nsis
  icon: resources/brand/png/nestbox.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
mac:
  target: dmg
  icon: resources/brand/png/app-icon-512.png
```

- [ ] **Step 2: Write `CLAUDE.md`**

````markdown
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
- **pnpm.** Electron's install script runs only because of `pnpm.onlyBuiltDependencies`.
- **shadcn.** Generated components in `src/renderer/components/ui/` are excluded from lint. The style is `new-york` (Radix, `asChild`). Don't let the CLI rewrite `globals.css`.
- **Workspace ids.** A workspace package's id is `<rootId>::<relPath>`. Workspaces are derived live and never stored.
````

- [ ] **Step 3: Append a "Development" section to `README.md`**

````markdown
## Development

Requirements: Node 22.12+, pnpm 10.

```bash
pnpm install
pnpm dev        # run the app
pnpm test       # unit tests
pnpm lint && pnpm typecheck
```

See [CLAUDE.md](CLAUDE.md) for structure and conventions.
````

- [ ] **Step 4: Full verification (fresh install)**

```bash
rm -rf node_modules out
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Expected: every command exits 0. Record the test counts per Vitest project from the output.

- [ ] **Step 5: Manual acceptance on Windows** (controller or user; tick each box)

`pnpm dev`, then:
- [ ] The window opens with a dark custom title bar, native caption buttons, the mark, "nestbox" and the version.
- [ ] The empty state shows "No projects yet". "Add project" opens the folder picker. Cancelling does nothing.
- [ ] Adding a pnpm monorepo nests its workspaces in the sidebar. Detection shows the scripts, env file names, workspaces, prisma, compose, git branch and Claude files.
- [ ] Adding the same folder again with a different case or a trailing `\` shows the "already added" toast.
- [ ] Rename (Enter and Escape), Pin/Unpin (a Pinned section appears) and Remove (with confirm) all work.
- [ ] "Open in VS Code" and "Open terminal here" work on a folder named like `C:\tmp\R&D 100%; test`. Create one if needed.
- [ ] After deleting a project folder on disk, "Open in VS Code" shows the "no longer exists" toast and the project is marked missing.
- [ ] After closing and re-running `pnpm dev`, the projects are still there. `%APPDATA%\nestbox\config.json` has `"schemaVersion": 1` and no env values.
- [ ] Corrupting `config.json` (writing `{oops`) and restarting gives an empty list, a `config.corrupt-*.json` backup, and a warning in the terminal.
- [ ] Starting a second `pnpm dev` instance focuses the first window.
- [ ] DevTools shows no CSP violations, and the Network tab shows no external requests.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md electron-builder.yml
git commit -m "docs: add CLAUDE.md, development notes and electron-builder config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

After Task 17 the controller runs superpowers:verification-before-completion and superpowers:requesting-code-review on the whole `m0-skeleton` branch, updates the Obsidian `Projects/Nestbox/` notes, and stops with a summary for the user. M1 doesn't start without the user's go-ahead.

---

## Milestone outlines (M1–M3)

These are outlines, not plans. Each one gets its own design notes and a detailed plan before any work starts.

**M1: Scripts and logs**
- **Process manager.** A `ProcessManager` service in main. It spawns scripts through a real `PlatformAdapter.spawnScript`, using the detected package manager, a `.cmd`-safe launch through `win32-escape` and `FORCE_COLOR=1`. Stop, restart and quit use `killTree` (`taskkill /PID <pid> /T /F`). Tracked PIDs are recorded so orphans can be cleaned up on the next start.
- **Scripts tool.** Built on the M0 tool contract, with start, stop and restart, auto-restart with backoff and a crash counter, and run groups persisted in `Project.runGroups`.
- **Log pipeline.** Logs live in per-process ring buffers (`logBufferLines`). Main batches lines to the renderer about every 50 ms over `tools:event`.
- **Log viewer.** Virtualised with `@tanstack/react-virtual`. Plain mode renders ANSI colours with search and `file:line` links that call `openInEditor(path, line)`. JSON mode parses pino and NestJS output, with level, context and requestId filters. Lines can be exported to a file. Each script gets its own pane, with a split view for two.
- **Tray.** Uses the coloured-hole PNGs at 16 px plus a 32 px @2x representation. The icon shows the worst state across processes, and a native notification names a crashed process.
- **Store migration v1 → v2.** Adds `trayIconTheme: 'auto' | 'dark-taskbar' | 'light-taskbar'`, the first real migration.
- **Window behaviour.** `closeToTray` hides the window instead of quitting. Quit from the tray asks for confirmation, then stops all tracked processes.
- **Graceful quit.** In `before-quit`, call `event.preventDefault()`, then `await toolHost.disposeAll()` raced against a timeout (about 5 s; log the tools that didn't finish), then call `app.quit()` again with a guard flag so the second pass goes through. This replaces M0's fire-and-forget `void toolHost.disposeAll()`.
- **UI.** A "Stop all" header button (Nestbox-started processes only), sidebar status dots and a process count in the status bar.
- **Testing.** Playwright Electron end-to-end tests are introduced: launch, add a fixture project, run a script, read its log.

**M2: Ports and env**
- **Port listing.** The Windows `listListeningPorts` uses `netstat -ano` and `tasklist /FO CSV`, parsed with fixture-based tests. A port-manager tool lists every listening TCP port, joined with the scripts runner's shared context, so a port shows as "3000 is `api` in shop-backend, started by `pnpm start:dev`".
- **Killing.** Kill confirms only for processes Nestbox didn't start, and there is no "free all". When a log shows `EADDRINUSE`, a "kill and restart" action is offered.
- **Watch list.** Common ports appear on the Overview.
- **Env tool.** A comment- and order-preserving `.env` parser and writer. A matrix of every `.env*` file (keys as rows, files as columns), flagging keys missing from `.env` and keys the example doesn't document.
- **Secrets.** Values are masked and revealed one at a time, never all at once. Copy works without revealing.
- **Profiles.** Switching profile copies the file and keeps a backup.
- **Shared context.** The env tool publishes `PORT`, `DATABASE_URL` and URL-like keys. Values never reach the logs or the store.

**M3: Static server and ship**
- **Static server tool.** Built on `http`/`https` with `sirv`: SPA fallback, `0.0.0.0` binding with the LAN URL and a QR code, and optional `selfsigned` HTTPS. Toggles for CORS, no-cache and simulated latency. The default port never clashes with the dev server. The request log feeds the M1 log viewer.
- **Claude Code panel.** Shows the `claude --version` status, a `CLAUDE.md`/`CLAUDE.local.md` preview with editing, read-only lists of `.claude/` commands, agents, skills and settings, and the `.mcp.json` servers. Warns when local files aren't gitignored.
- **Claude Code actions.** Open and Continue, through the M0 `openTerminal(cwd, command)`, which gets end-to-end tests then. A headless quick prompt streams into the log viewer.
- **Context generator.** Its output appears as a diff of the `<!-- nestbox:start/end -->` block, with Apply.
- **Command palette.** `Ctrl+K` on Windows, `⌘K` on macOS; projects, tools, scripts and Claude entries.
- **Shipping.** The NSIS installer is built by GitHub Actions on release tags. The README gets a GIF, an architecture section and a "how to write a tool" guide; the lockup wordmark is converted to outlines.
