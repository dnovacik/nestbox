# NestBox v2: more ecosystems (plan)

The owner's answers (2026-10-07):

- Split dnovacik/nestbox#32 (Python support, by jubele) in two:
  - the language-neutral half goes into its own PR, **1.21.0**;
  - Python comes back as the first ecosystem module, aligned with this plan.
- The generic command machinery goes into the 1.21.0 PR. That covers:
  - argv commands;
  - custom commands;
  - a main command per package;
  - an env file per command.
- Shape: **one module per ecosystem** under `src/main/ecosystems/<id>/`, behind one interface. `DetectedProject.ecosystems` is a list. Node keeps `packageJson` for now and moves in later.

## Why

NestBox stays a toolbox for projects, not a Node-only one. A Python API next to a Vite front end is common, and so is a .NET service. Most tools already apply to any folder: Git, CI, TODOs, Env, Compose, Health, Mock API, Inspector, Ports and Claude. What ties NestBox to Node is narrower:
- detection, which needs a `package.json`;
- the script list, which is npm scripts;
- the run environment, which is the package manager and fnm;
- the Node and Dependencies tools.

An ecosystem module replaces exactly those parts, so a new language means one folder, not edits all over the tree.

## 1.21.0: the language-neutral half (merged)

Taken from dnovacik/nestbox#32 with the Python removed, this PR is now merged to main:

- **Commands without a shell.**
  - `shared/command-line.ts` splits a typed line into argv (`"`-quoted words, no `KEY=value` prefix, no `"`, CR, LF or NUL inside a word) and formats it back.
  - `ProcessManager.StartRequest` takes `argv`, `env`, `pathPrepend` and `loadEnv`. The env file is read at every start; only the count is logged.
- **Custom commands.**
  - Stored in `toolSettings.scripts.commands` (relPath, name, argv; at most 100).
  - The Scripts tab gains "Add command" plus Edit and Delete.
  - The tool now applies to every package, including one without scripts.
- **Per-command settings.**
  - **Env file:** `envFiles[relPath/name]`. Custom commands default to `.env`; npm scripts default to none, because their tools load `.env` themselves.
  - **Main command:** `main[relPath]`, a star in the list. It is used by:
    - the overview card's "Start <main>";
    - a new run group, which starts with each package's main ticked;
    - the command palette.
- **Env tool.**
  - Raw edit of the whole file (`readRaw`/`writeRaw`, version-checked).
  - Add variable.
  - Create a missing env file.
  - `codeKeys`: names read in the source, such as `process.env.X` and `os.getenv("X")`; names only, never values. It uses `fs/source-text.ts`, which it shares with the TODOs scan.
- **Projects.**
  - Remove in the sidebar row menu.
  - "Add as one project" in the add-folders dialog.

## The ecosystem module

```ts
// src/main/ecosystems/types.ts
interface EcosystemModule<Info> {
  id: EcosystemId;                       // 'python' | 'dotnet' | later 'node'
  /** Pure filesystem detection of one folder. No Electron, no subprocess. */
  detect(dir: string, files: string[], dirs: string[]): Promise<Info | null>;
  /** Globs that make a sub-folder a package (multi-folder projects, v1.18). */
  packageGlobs: string[];
  /** Commands the ecosystem offers without the user typing them. */
  tasks(info: Info): DetectedTask[];     // { name, argv, title }
  /** How a command of this package runs: PATH entry, env, program substitution, a note. */
  runEnv(ctx: RunEnvContext, info: Info): Promise<RunEnv>;
  // Later, optional: version(ctx) for the Node tool's twin, deps(ctx) for Dependencies.
}
```

**Rules.**
- `detect` stays pure, like `detectProject`, and is cheap. It runs for every folder on refresh.
- Platform differences, such as the venv `bin` vs `Scripts` folder and `python3` vs `py`, live in the platform adapter (`PlatformAdapter.ecosystem…` helpers). That keeps `process.platform` in `src/main/platform/`.
- Program names and argv that reach a command line follow the existing rules: `cmdInvocation` on Windows, plain tokens only.

**Data.**
- `DetectedProject.ecosystems: { id, info }[]`, with each `info` Zod-validated by its module's schema.
- `isPackage` becomes `packageJson !== null || ecosystems.length > 0`.
- Workspaces: `findWorkspaceDirs` adds each module's `packageGlobs` to `*/package.json` and `*/*/package.json`.

**Scripts tool.**
- Rows are `npm`, `detected` (from `tasks`) and `custom`, in that order. `SCRIPT_KINDS` gains `detected`.
- `hideCommand`/`showCommand` (`toolSettings.scripts.hidden[relPath]`) remove a detected task, which can be restored below the list.
- A detected or custom command runs with the module's `runEnv` for that package: `pathPrepend`, `env`, and a program substitution such as `python` → the venv's interpreter.
- npm scripts keep the Node path: the package manager plus the `startAdvice` from fnm and the Node tool.

**Project info.** Each module may add a summary line, for example `Python 3.12 · uv · .venv`.

## The ecosystem framework (PR A: v2-ecosystems, 1.22.0)

The framework lands with .NET, before Python. It includes:

**Interface** (`src/main/ecosystems/types.ts`):
```ts
export type EcosystemId = 'python' | 'dotnet' | 'node';

export interface DetectedTask {
  name: string;
  argv: string[];
  title: string;
}

export interface RunEnv {
  pathPrepend?: string;
  env?: Record<string, string>;
  note?: string;
}

export interface RunEnvContext {
  dir: string;
  platform: PlatformAdapter;
  settings: <module-specific settings type>;
}

export interface EcosystemModule<Info, Settings = unknown> {
  id: EcosystemId;
  infoSchema: z.ZodSchema<Info>;
  
  /** Pure filesystem detection of one folder. No Electron, no subprocess. */
  detect(dir: string, files: string[], dirs: string[]): Promise<Info | null>;
  
  /** Globs that make a sub-folder a package (multi-folder projects, v1.18). */
  packageGlobs: string[];
  
  /** Commands the ecosystem offers without the user typing them. */
  tasks(info: Info): DetectedTask[];
  
  /** How a command of this package runs: PATH entry, env, program substitution, a note. */
  runEnv(ctx: RunEnvContext, info: Info): Promise<RunEnv>;
  
  /** Optional: one-line summary for project-info (e.g. "Python 3.12 · uv · .venv"). */
  summary?(info: Info): string | null;
  
  /** Optional providers for later phases. */
  version?(ctx: RunEnvContext, info: Info): Promise<string | null>;
  deps?(ctx: RunEnvContext, info: Info): Promise<DepsResult>;
}
```

**Generic wiring:**
- `DetectedProject.ecosystems: Array<{ id: EcosystemId; info: unknown }>` (each `info` validated by its module's `infoSchema`)
- `isPackage` becomes `packageJson !== null || ecosystems.length > 0`
- `findWorkspaceDirs` adds each module's `packageGlobs` to the existing `*/package.json` and `*/*/package.json`
- `projects:scan` counts ecosystem packages in `folders` (like it does for Node packages)
- Scripts tool:
  - `appliesTo` includes `ecosystems.length > 0`
  - Rows are `npm`, `detected`, `custom` (in that order); `SCRIPT_KINDS` gains `detected`
  - `hideCommand`/`showCommand` via `toolSettings.scripts.hidden[relPath]` (Zod default `{}`, store stays v2)
  - Detected commands restored below the list when hidden
  - `runEnv` applied to detected and custom commands (module looked up by package's ecosystem)
- Project-info: each module's optional `summary()` adds a line

**Tests:**
- Unit tests use a tiny test-only module (not a real language), registered only in test files
- Verify the generic wiring works without touching Node-specific code

## .NET module (PR B: v2-dotnet, 1.23.0)

**Status:** built in dnovacik/nestbox#37 (1.23.0); decisions and differences from this section are in [the .NET design](2026-10-07-nestbox-v2-dotnet-design.md).

Stacked on `v2-ecosystems`. Becomes the first real ecosystem module.

**Detection** (pure filesystem, size caps like other detectors):
- `*.sln` / `*.slnx` (solution files)
- `*.csproj` / `*.fsproj` / `*.vbproj` (project files) in the folder
- `global.json` (sdk.version, rollForward) — read and parse
- `Properties/launchSettings.json` profiles — read and extract applicationUrl ports
- Never read `environmentVariables` values or user secrets from launch settings

**Package globs:**
- `*/*.csproj`, `*/*.fsproj`, `*/*.vbproj`
- `src/*/*.csproj`, `src/*/*.fsproj`, `src/*/*.vbproj`
- Skip: `bin/`, `obj/`, `test*/`, `*test*/`, `*Test*/`, `*.Tests/`, `*.IntegrationTests/`

**Tasks** (detected commands):
- `dotnet run` (always)
- `dotnet watch` (always)
- `dotnet test` (when test projects detected: references `Microsoft.NET.Test.Sdk` or `xunit`/`nunit`/`MSTest` packages)
- `dotnet build` (always)
- `dotnet run --launch-profile <name>` for each `Project` commandName profile in `launchSettings.json`
  - Profile names validated: must match `COMMAND_NAME_SAFE` pattern before reaching argv

**runEnv:**
- Environment: `DOTNET_NOLOGO=1`, `DOTNET_CLI_TELEMETRY_OPTOUT=1`, `DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1`
- PATH: `dotnet` resolved through existing spawn path logic
  - Windows: already on PATH via system install
  - macOS: check if `~/.dotnet` needs adding to PATH (test with/without it)
- No program substitution needed (unlike Python's venv interpreter)

**Ports/Health integration:**
- Parse `applicationUrl` from launch profiles (e.g. `https://localhost:5001;http://localhost:5000`)
- Extract ports and register as Health suggestions
- Help port attribution (like PORT from .env does)

**Version check:**
- Read `global.json` sdk.version
- Run `dotnet --list-sdks` (via `execCommand`, cached like Node tool)
- Parse SDK list, check if required version is available
- Show in project-info summary: `.NET 8.0` or `.NET 8.0 (requires 8.0.100, 8.0.403 available)`
- startAdvice-style warning on script start if SDK not available (fits cleanly like Node warning)

**Dependencies:**
- Two separate commands (flags cannot be combined — verify this):
  - `dotnet list package --outdated --format json`
  - `dotnet list package --vulnerable --format json`
- Only on Check or schedule (network exception like npm)
- Parse into existing deps row shape
- Keep: package names, versions (current/requested/resolved/latest), advisories (severity/URL)
- JSON shape: verify against real .NET SDK if available, otherwise use Microsoft docs and document assumption

**Out of scope** (documented in design):
- NuGet restore prompts
- Visual Studio integration
- MAUI and Xamarin projects
- User secrets management
- EF Core migrations (future follow-up, like Prisma)

**Tests:**
- Unit tests for `detect`, `tasks`, `runEnv`, dependency parsers with fixtures
- Use real `dotnet` output for fixtures where possible
- e2e with `e2e/fixtures/fake-dotnet` (logs calls to `.fake-dotnet.log` like `fake-gh`)
- Fixture: solution with two projects and a launch profile
- e2e: add folder, show detected tasks, start one, hide and restore a task, run dependency check

## Python module (dnovacik/nestbox#32, after the framework)

Most of the PR's Python code fits. It moves and changes as follows:

| In #32 | Becomes |
| --- | --- |
| `detection/python.ts` | `ecosystems/python/detect.ts` (`detect`), unchanged rules: `pyproject.toml`, `requirements*.txt`, `Pipfile`, `setup.py`, manage.py / FastAPI / Flask hints |
| `DetectedProject.python` | an entry in `ecosystems` (`{ id: 'python', info }`) |
| Python globs in `workspaces.ts` | `packageGlobs` of the module |
| `platform.pythonCommand`/`venvBinDir` | adapter helpers called only by the module |
| `scripts/python-envs.ts` (venv choice, `VIRTUAL_ENV`, `PYTHONUNBUFFERED`) | `runEnv`; the choice stays in `toolSettings.scripts.venvs[relPath]` |
| detected commands (runserver, uvicorn, flask, pytest…) | `tasks` |
| hide/show of detected commands | generic, in the Scripts tool (any module's tasks) |
| `PythonEnvPicker`, `pythonEnvs`/`setVenv` methods | stay, shown when the package has a `python` ecosystem |
| `python-files.ts` + "Run a Python file" in `CommandDialog` | stays as a module-provided picker (`files(info)`), optional |
| project-info `python-summary` | the module's summary line |
| `e2e/python.spec.ts`, `python-app` fixture | stay |

**The colleague's PR then:**
1. rebases on 1.21.0. The commands, env-file, main, env tool and project-menu parts are already there, so they drop out of the diff;
2. adds `src/main/ecosystems/` with `types.ts`, the registry and `python/`;
3. wires `ecosystems` into detection, workspaces, `isPackage` and the Scripts tool as above;
4. keeps every test, moved next to its new file, and the e2e;
5. updates CLAUDE.md (an "Ecosystems" gotcha and the folder table).

## How to add an ecosystem module

1. **Create the module** under `src/main/ecosystems/<id>/`:
   - `index.ts`: export the `EcosystemModule` implementation
   - `detect.ts`: pure filesystem detection (no Electron, no subprocess)
   - `tasks.ts`: detected commands (name, argv, title)
   - `run-env.ts`: how commands run (pathPrepend, env, note)
   - Unit tests next to each file with fixtures

2. **Register in** `src/main/ecosystems/index.ts`:
   - Add to `ECOSYSTEM_MODULES` registry
   - Export the id in `EcosystemId` type

3. **Wire detection** in `src/main/detection/detect-project.ts`:
   - Call each module's `detect()` 
   - Build `ecosystems: Array<{ id, info }>` with validated info

4. **Update workspaces** in `src/main/projects/workspaces.ts`:
   - Add module's `packageGlobs` to the glob list

5. **Scripts tool integration**:
   - Detected commands appear as `kind: 'detected'` rows
   - Apply `runEnv` when starting detected or custom commands
   - Module-specific UI (like Python's venv picker) goes in the renderer

6. **Project-info integration**:
   - Optional `summary()` adds a line to the project info

7. **Tests**:
   - Unit tests for detect, tasks, runEnv with fixtures
   - e2e fixture project in `e2e/fixtures/<ecosystem>-app`
   - e2e spec covering: add, list tasks, start, hide/restore

8. **Documentation**:
   - Add gotchas to CLAUDE.md
   - Update folder table in CLAUDE.md if adding new folders

## Later

1. **Node into the module.** Move `packageJson`, package managers, fnm and `startAdvice` behind the same interface, then drop the special case from the Scripts tool.
2. **Any git repository is a project.** Even with no ecosystem, it gets the generic tools.
3. **Makefile and justfile targets** as detected tasks of a `make` module.
4. **Version and Dependencies providers** per module (`version`, `deps`) so those tools stop being Node-only.
