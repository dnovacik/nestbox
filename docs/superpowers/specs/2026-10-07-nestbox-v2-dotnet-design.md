# NestBox v2: .NET solutions (design, 1.23.0)

PR B of the [ecosystems plan](2026-10-07-nestbox-v2-ecosystems-plan.md), built on dnovacik/nestbox#37 (`.sln` parsing). The owner asked to fix what was wrong with #37 and add the plan's .NET module, then release once tested locally.

## What #37 got wrong, and the fix

- **Project folders were looked up by `package.json`.** The solution's paths became workspace patterns, globbed as `<dir>/package.json`. A real .NET project has none, so a real solution found nothing (its tests put a `package.json` in each project folder).
- **A solution hid Node sub-folders.** Any root `.sln` made the patterns non-empty, which skipped the sub-folder fallback.
- **Already broken on `main` (#35):** `subFolderPackages` globbed the modules' file patterns with `onlyDirectories`, so no `.csproj` folder was ever a package. Node's own `**/package.json` would have reached any depth once that was fixed.
- **The fix.** `packageGlobs` are file patterns, one or two levels down; the folder of a match is the package and `skipDir` drops names (`bin`, `obj`, test folders). An optional `workspaceDirs(root)` hook adds folders the root lists itself (a solution's projects), *next to* declared workspaces or sub-folder packages. Solution parsing moved into `ecosystems/dotnet/` (one folder per ecosystem), with `.slnx` (what `dotnet new sln` writes since .NET 10) and a 1 MiB cap.

## The module (`src/main/ecosystems/dotnet/`)

| File | Does |
| --- | --- |
| `detect.ts` | The folder's first solution and project file by name; the project file (256 KiB) for target frameworks, web SDK and test project; `Properties/launchSettings.json` (64 KiB) for `Project` profiles, names and http ports only; the nearest `global.json` at or above the folder (16 KiB) for the SDK version and `rollForward`. |
| `solution.ts` | `.sln` lines and `.slnx` `<Project Path>`; test projects stay out of the package list (the solution's `dotnet test` runs them). |
| `tasks.ts` | run, watch, `run:<profile>` per launch profile, build, test (a solution or a test project), restore, clean. A folder with both runs the project and builds the solution. |
| `sdk.ts` | `dotnet --list-sdks` parsing and roll-forward matching (patch/feature/minor/major, their `latest*` forms, `disable`; prereleases only match a prerelease request). |
| `deps.ts` | `dotnet list <project> package --outdated` and `--vulnerable --include-transitive`, both `--format json`. |
| `env.ts` | `DOTNET_NOLOGO`, `DOTNET_CLI_TELEMETRY_OPTOUT`, `DOTNET_SKIP_FIRST_TIME_EXPERIENCE` for every `dotnet` NestBox runs. |

**Run env.** `dotnet` from PATH, else `~/.dotnet` (dotnet-install's folder) put first on PATH with a note, else a warning. With a `global.json`, a start warns (badge ".NET", first log line) when no installed SDK satisfies it; the SDK list is cached 30 s and a failure says nothing. Custom commands in a .NET package get the same env and warning (the Scripts tool now applies a package's ecosystem env to custom commands, 3 s cap like the Node tool's advice).

**Health.** The first launch-profile http port is the suggestion when `.env` has no `PORT`.

**Dependencies.** Applies to packages with a .NET ecosystem. Rows keep NuGet ids, requested/resolved/latest versions, severities and https advisory URLs; project paths and feed URLs in the output are dropped. "Copy update command" is `dotnet add package <id>`. A solution-only folder has nothing of its own (no result); the schedule's "last checked" now looks at a root's packages too.

**Project card.** Each ecosystem entry carries its module's summary: `.NET · net10.0 · web · SDK 9.0.100`.

**Scripts.** Detected rows get Hide (not while running); hidden tasks are listed below with Restore (the contract had `hideCommand`/`showCommand` without UI).

## Choices that differ from the plan

- Package globs are `*/*.csproj` and `*/*/*.csproj` (and F#/VB), not `src/*/…` only: the same two levels as Node.
- The SDK mismatch shows on a start (warning badge and log line), not in the summary: the summary comes from detection, which runs no subprocess.
- Port attribution needs nothing: it walks the process tree, so `dotnet run`'s ports already belong to the script.
- restore and clean stay (they were in #35's module).

## Not verifiable in CI

The real `dotnet run`/`watch` and SDK resolution against `global.json`, `~/.dotnet` on macOS, private NuGet feeds and their auth, and SDKs older than 7.0.200 (no `--format json`: the step shows as failed). The fixtures are real SDK 10.0.401 output, except the transitive-vulnerability case, which follows the documented shape. The e2e uses `e2e/fixtures/fake-dotnet`.

## Follow-ups

- The Inspector's default target could use a launch-profile port like Health does.
- EF Core migrations (like Prisma), user secrets: out of scope (plan).
