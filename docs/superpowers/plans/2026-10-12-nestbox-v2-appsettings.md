# appsettings.json in the Env tool Implementation Plan (1.24.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Configuration section in the Env tool for `appsettings*.json` (.NET's colon keys), with masked values, reveal/copy, format-keeping single-value and raw edits, and each launch profile's environment.

**Architecture:** A pure module (`tools/env/appsettings.ts`) parses JSONC with `jsonc-parser`, flattens it into .NET keys and makes format-keeping edits with `modify`/`applyEdits`. A file access (`config-files.ts`) lists and reads/writes the files through `fs/versioned-file`. `config-matrix.ts` builds the presence-only matrix. The Env tool gets new `config*` methods next to the `.env` ones; the renderer reuses `ValueCell`, `EditValueDialog`, `AddVariableDialog` and `RawEditDialog` (generalised) in a new `ConfigSection`.

**Tech Stack:** TypeScript, Zod, `jsonc-parser` 3.3.1 (main `dependency`), React + TanStack Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-nestbox-v2-appsettings-design.md` · Issue #39

## Global Constraints

- File names: `^appsettings(\.[A-Za-z0-9_-]{1,40})?\.json$`. Columns: `appsettings.json`, then `Development`, `Staging`, `Production`, then the rest alphabetically.
- Caps: 1 MiB per file, 2,000 keys per file, 20 files. Over a cap → `tooLarge`, not read.
- Config keys: segments of `[A-Za-z0-9_.$-]` joined by `:`, at most 200 characters.
- Never: values in logs, stored state or the matrix; keys in logs (file names, methods and codes only).
- Edits keep comments, order, indentation, line endings and a BOM byte-identical outside the edited value.
- A stale version is CONFLICT; symlinked files are read-only (FORBIDDEN on write).
- Raw saves must parse as JSONC with an object root (VALIDATION, message without content).
- Environment names: `^[A-Za-z0-9_-]{1,40}$`; a profile without one is `Production`.
- `jsonc-parser` is a main `dependency` (not dev).

## Review Focus

1. **Case-insensitive paths:** editing `logging:loglevel:default` must change the existing `Logging:LogLevel:Default`, not add a second key. Test in Task 1 (`setConfigValue` resolves case-insensitively).
2. **BOM + CRLF files** (Visual Studio writes them): an edit must keep both. Test in Task 1.
3. **Adding under a scalar or into an array:** `A:B` when `A` is a string is CONFLICT; `Arr:2` on a two-item array appends; `Arr:5` is VALIDATION. Tests in Task 1.
4. **An invalid file** (half-typed JSON) must not break the matrix: listed `invalid`, raw edit only, single edits VALIDATION. Tests in Tasks 1 and 3.
5. **A `.env` file in a .NET package** still shows its section; a .NET package with neither gets the Configuration section with the profile lines (no "No .env files"). Test in Task 5.

---

### Task 1: appsettings parsing and edits (pure)

**Files:**
- Modify: `package.json` (add `"jsonc-parser": "3.3.1"` to `dependencies`)
- Create: `src/main/tools/env/appsettings.ts`, `src/main/tools/env/appsettings.test.ts`
- Modify: `src/shared/tools/env/contract.ts` (constants only: `APPSETTINGS_FILE`, `CONFIG_KEY`, `CONFIG_TYPES`, `EDITABLE_CONFIG_TYPES`, `JSON_NUMBER`)

**Interfaces (produces):**
```ts
export type ConfigType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
export type EditableConfigType = 'string' | 'number' | 'boolean' | 'null';
export interface ConfigLeaf { key: string; path: (string | number)[]; type: ConfigType; empty: boolean }
export const MAX_CONFIG_KEYS = 2000;
/** null when the text isn't JSONC with an object root. */
export function parseConfig(text: string): ConfigLeaf[] | null;
/** The last leaf matching key case-insensitively (.NET: last wins). */
export function findLeaf(leaves: readonly ConfigLeaf[], key: string): ConfigLeaf | undefined;
/** Display keys that appear more than once ignoring case. */
export function caseDuplicates(leaves: readonly ConfigLeaf[]): string[];
/** The value as shown: the string itself, else its JSON source text. */
export function leafValue(text: string, leaf: ConfigLeaf): string;
export function toJsonValue(value: string, type: EditableConfigType): string | number | boolean | null; // VALIDATION on a bad number/boolean
export function setConfigValue(text: string, key: string, value: unknown): string;   // existing or new key
export function addConfigKey(text: string, key: string, value: unknown): string;     // CONFLICT when it exists or a parent is a value
export function removeConfigKey(text: string, key: string): string;                  // NOT_FOUND when absent
export function configColumnRank(name: string): number;
```

- [ ] **Step 1: failing tests** — flatten nesting (`Logging:LogLevel:Default`), arrays by index (`AllowedOrigins:0`), empty `{}`/`[]` are leaves with `empty`, `""`/`null` are `empty`, comments and trailing commas parse, non-object root and syntax errors return null, case duplicates; `setConfigValue` keeps a comment, a trailing comma, CRLF and a BOM byte-identical outside the value, resolves the path case-insensitively, changes a string to a number; `addConfigKey` creates missing parents, appends to an array at `length`, refuses an existing key and a scalar parent (CONFLICT), refuses an index past the end (VALIDATION); `removeConfigKey` leaves `{}` after the last key; `toJsonValue` refuses `1e999`, `abc` as number and `yes` as boolean; column order.
- [ ] **Step 2:** `pnpm vitest run src/main/tools/env/appsettings.test.ts` → FAIL (module missing).
- [ ] **Step 3:** implement with `parseTree(text, errors, { allowTrailingComma: true })`, `modify(text, path, value, { formattingOptions })` and `applyEdits`; strip a leading `﻿` before parsing/editing and put it back; formatting options from the text (`\r\n` if present; indentation from the first indented line, default 2 spaces).
- [ ] **Step 4:** tests pass.
- [ ] **Step 5:** commit `feat(env): parse and edit appsettings.json keeping its format`.

### Task 2: launch profile environments

**Files:** Modify `src/main/ecosystems/dotnet/detect.ts`, `detect.test.ts`.

**Produces:** `launchProfiles: { name; ports; environment: string }[]` (`environment` has Zod default `'Production'`).

- [ ] **Step 1: failing test** — `ASPNETCORE_ENVIRONMENT` wins over `DOTNET_ENVIRONMENT`; a value failing `^[A-Za-z0-9_-]{1,40}$` and a profile without one give `Production`; other variables (a secret) never appear in the result (`JSON.stringify` check).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement in `parseLaunchSettings`. **Step 4:** pass (also `index.test.ts`, `tasks` tests that build infos by hand get the field). **Step 5:** commit `feat(dotnet): each launch profile's environment name`.

### Task 3: config file access, matrix and Env tool methods

**Files:**
- Create: `src/main/tools/env/config-files.ts` (+ test), `src/main/tools/env/config-matrix.ts` (+ test)
- Modify: `src/shared/tools/env/contract.ts` (schemas + methods), `src/main/tools/env/index.ts` (+ `index.test.ts`), `src/main/index.ts` (wiring; the folder watch also passes `APPSETTINGS_FILE` names)

**Contract (produces):**
```ts
ConfigMatrixSchema = {
  dotnet: boolean,               // the package's first ecosystem is dotnet
  files: { name; version: string | null; readOnly; tooLarge; invalid; entries; caseDuplicates: string[] }[],
  keys: { key; cells: Record<file, 'set'|'empty'|'absent'>; overridden; envOnly }[],
  profiles: { name; environment; file; exists }[],
  truncated: boolean,            // more than 20 files
}
configMatrix({}) ; configReveal({ file, key }) → { value, type } ; configCopy({ file, key }) → {}
configSetValue({ file, key, value, type, version }) → { version }
configAddKey({ file, key, value, type, version: string | null }) → { version }   // null creates the file
configRemoveKey({ file, key, version }) → { version }
readConfigRaw({ file }) → { text, version } ; writeConfigRaw({ file, text, version }) → { version }
createConfigFile({ environment }) → { version, file }
```
`ConfigFileAccess { list(dir): { name; readOnly }[]; read; write }` (versioned files, noun `settings file`, 1 MiB).

- [ ] **Step 1: failing tests** — matrix: columns in order, presence only (a secret never in `JSON.stringify(matrix)`), case-insensitive rows, `overridden`/`envOnly`, invalid and too-large files listed, profiles from the project's dotnet info with `exists` (case-insensitive), `dotnet` flag; reveal returns a string as is and a number as source text; copy writes the clipboard; set/add/remove keep a comment; CONFLICT on a stale version; FORBIDDEN for a symlink (skip on Windows without symlink rights); `writeConfigRaw` refuses `{` and `[]` (VALIDATION, message without the text); `createConfigFile` writes `{}` and is CONFLICT when it exists; logs carry no keys/values; `changed` is emitted after writes.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** pass. **Step 5:** commit `feat(env): appsettings methods in the Env tool`.

### Task 4: Scripts default env file in .NET packages

**Files:** Modify `src/main/tools/scripts/index.ts` (+ `index.test.ts`).

- [ ] **Step 1: failing test** — in a package whose first ecosystem is `dotnet`, a custom command and a detected task list `envFile: null`; an explicit pick of `.env` is stored and kept; a Node package's custom command still gets `.env`.
- [ ] **Step 2–4:** `defaultEnvFile(runnable, project)`; `setEnvFile` compares against it. **Step 5:** commit `feat(scripts): .NET commands default to no env file`.

### Task 5: Renderer — Configuration section, card

**Files:**
- Create: `src/renderer/tools/env/ConfigSection.tsx`, `src/renderer/tools/env/TypedValueInput.tsx`, `src/renderer/tools/env/ConfigSection.test.tsx`
- Modify: `ValueCell.tsx` (takes `reveal(): Promise<string>`), `EditValueDialog.tsx` (takes `load`, optional `typed`), `AddVariableDialog.tsx` (key pattern/hint, new-file name, optional `typed`), `RawEditDialog.tsx` (`kind: 'env' | 'config'`), `Panel.tsx` (ordering), `use-env.ts` (`useConfigMatrix`, `useConfigEdit`, `revealConfigValue`, `useCreateConfigFile`), `OverviewCard.tsx` (+ tests)

- [ ] **Step 1: failing tests** (jsdom, bridge stubbed like `Panel.test.tsx`) — a .NET package shows Configuration first and no "No .env files"; profile line `http → Development`, and "Create appsettings.Production.json" calls `createConfigFile`; reveal calls `configReveal`; edit dialog loads the value and type and saves `configSetValue` with the chosen type; a number type refuses `abc`; `overridden`/`env only` badges; an invalid file shows a warning and only raw edit; a Node package without appsettings shows no Configuration section; the card shows the settings file count and an invalid warning.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** pass, including the existing env tests. **Step 5:** commit `feat(env): Configuration section for appsettings.json`.

### Task 6: End-to-end, docs, version

**Files:** `e2e/fixtures/dotnet-app/src/Shop.Api/appsettings.json` (with a comment), `appsettings.Development.json`; `e2e/appsettings.spec.ts`; `CLAUDE.md` (Env gotcha); `README.md` (Env/.NET rows, roadmap); `package.json` version `1.24.0`.

- [ ] **Step 1:** e2e: open Env on Shop.Api, matrix and `http → Development`; reveal a value; edit one and check the comment survives on disk; add a key; a raw edit that doesn't parse is refused; create `appsettings.Production.json` from the profile line.
- [ ] **Step 2:** `pnpm build && pnpm e2e e2e/appsettings.spec.ts e2e/env.spec.ts e2e/dotnet.spec.ts` → pass.
- [ ] **Step 3:** `pnpm lint && pnpm typecheck && pnpm test` → pass.
- [ ] **Step 4:** docs and version; commit `docs: appsettings in the Env tool (1.24.0)`.
