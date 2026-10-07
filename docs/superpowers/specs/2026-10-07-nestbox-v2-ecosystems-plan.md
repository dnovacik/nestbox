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

## 1.21.0: the language-neutral half (this PR)

Taken from dnovacik/nestbox#32 with the Python removed:

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

## Python, the first module (dnovacik/nestbox#32, realigned)

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

## Later

1. **.NET.**
   - Detect `*.sln`/`*.csproj`/`*.fsproj`.
   - Tasks: `dotnet run`, `watch`, `test`, plus the profiles from `Properties/launchSettings.json`, whose `applicationUrl` feeds Ports and Health.
   - `global.json` drives the version check.
   - `dotnet list package --outdated --vulnerable --format json` feeds Dependencies.
2. **Node into the module.** Move `packageJson`, package managers, fnm and `startAdvice` behind the same interface, then drop the special case from the Scripts tool.
3. **Any git repository is a project.** Even with no ecosystem, it gets the generic tools.
4. **Makefile and justfile targets** as detected tasks of a `make` module.
5. **Version and Dependencies providers** per module (`version`, `deps`) so those tools stop being Node-only.
