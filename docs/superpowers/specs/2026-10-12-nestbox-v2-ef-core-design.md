# NestBox v2: EF Core commands in the Database tool (design, 1.26.0)

1.25.0 shows a .NET package's ConnectionStrings in the Database tab, but EF Core's migrations still need a terminal. This adds an **EF Core** card to the Database tab of a .NET package that uses EF Core: its migrations (applied or pending) for the environment picked in the Connections card, and the commands that list, add, apply, roll back, script and remove them. Every command runs inside NestBox with its output in the Database log. Issue #43.

## Owner's answers (2026-10-12)

- **Environment:** EF commands use the environment picked in the Connections card. Updating the database asks first when that environment isn't Development.
- **Commands:** the issue's three (list migrations, update database, add migration), plus script SQL, remove the last migration and update to a chosen migration.
- **Inside NestBox, no terminal.** EF's commands take their arguments up front and never prompt, unlike Prisma's `migrate dev`. Input to running commands is a separate idea: #45.
- **Approach:** an EF Core section of the Database tool, built like its Prisma commands (one run at a time per package, Stop, the shared log). Not detected tasks in the Scripts tool.

## When the card shows

- **The Design package:** the package's .NET project references `Microsoft.EntityFrameworkCore.Design` (`DotnetInfo.efDesign`, read from PackageReferences like `dbProviders`, Zod default `false`). Without it `status.ef` is `null` and there is no card. `dotnet ef` needs this package to build its design-time services.
- **The tool:** where `dotnet-ef` comes from, in this order:
  1. `local`: a tool manifest in the package folder or a parent (up to the drive root), as the `dotnet` CLI finds it: `.config/dotnet-tools.json`, then `dotnet-tools.json` (SDK 10's `dotnet new tool-manifest` writes the latter). The first manifest whose `tools` has a `dotnet-ef` entry wins (64 KiB cap, JSON; an unreadable manifest counts as absent). The walk stops after a manifest with `"isRoot": true`.
  2. `global`: `dotnet-ef` resolves on the PATH or in `~/.dotnet/tools` (the adapter's command lookup, no subprocess).
  3. `null`: the card shows how to install it (`dotnet tool install dotnet-ef`, as text with a Copy button) and no command buttons. NestBox never installs or downloads it.
- **DbContexts:** the package's `.cs` files are scanned for `class <Name> … : <Base>` where the base's last name ends with `DbContext` (`DbContext`, `IdentityDbContext<User>`, `My.Data.AppDbContext`). The scan:
  - goes through `fs/source-text.ts` (1 MiB per file, NUL check, real path inside the package);
  - skips `bin/`, `obj/` and dot folders, and stops after 2,000 files;
  - ignores `//` and `/* */` comments;
  - keeps at most 20 names, sorted, without duplicates.

  An abstract class is skipped (EF can't create it). With one context, no `--context` is passed. With several, a select picks one (the first by default) and every command gets `--context <Name>`. With none found, no `--context` is passed and EF decides.

## How commands run

- **Command line:** `dotnet ef <command> --project <project file> [--context <Name>] [--prefix-output] -- --environment <Env>`, with `cwd` = the package folder, through `spawnCommand` (shell env, stdin closed). The project file comes from detection.
  - Every argument is a NestBox-built word or a validated value (see Contract), so the same line is safe through cmd.exe.
  - `--connection`, `--verbose` and `--force` are never passed.
- **Environment:** the child also gets `DOTNET_ENV` (no telemetry, banner or first-run text), `ASPNETCORE_ENVIRONMENT` and `DOTNET_ENVIRONMENT` set to the picked environment, and the .NET ecosystem's `runEnv` PATH (`~/.dotnet` when dotnet isn't on PATH). `-- --environment` covers host-built apps. The variables cover a custom `IDesignTimeDbContextFactory` that reads them.
- **Commands:**

  | Kind | Arguments | Notes |
  | --- | --- | --- |
  | `ef-list` | `migrations list --json --prefix-output` | Fills the migration list |
  | `ef-add` | `migrations add <Name>` | Name from a dialog |
  | `ef-update` | `database update [<target>]` | No target = the latest |
  | `ef-script` | `migrations script --idempotent` | The SQL goes to the log; no `--idempotent` when SQLite is the only provider (EF can't script it) |
  | `ef-remove` | `migrations remove` | EF refuses when it's applied |
  | `ef-restore` | `dotnet tool restore` (not `ef`) | Only for a local tool |

- **One at a time:** EF and Prisma commands share the package's single command slot (`running.command`), so a second command while one runs is CONFLICT. Stop kills the tree and logs `■ stopped`. A run that takes longer than 10 minutes is stopped and logs `■ stopped after 10 minutes`.
- **Log lines:** `▸ dotnet ef migrations list (Development)` before a run; after it, `■ done`, `■ exited with code N` or `■ dotnet could not be started`. Every `ef` run passes `--prefix-output`: EF's own lines start with a 9-character prefix (`info:    `, `warn:    `, `error:   `, `data:    `, `verbose: `), which is stripped for the log. The app's own logging (`info: Microsoft.EntityFrameworkCore…` and its indented lines) has no such prefix and is logged as is. A list's `data:` lines are kept out of the log (the list shows them); a script's are its SQL and go to the log.
- **After a change:** `ef-add`, `ef-update` and `ef-remove` that exit 0 are followed by `ef-list`, so the list and pending count stay true.
- **Restore hint:** when a local-tool run fails and its output contains `dotnet tool restore`, the status sets `ef.needsRestore` (in memory, cleared by the next successful run). The card then shows **Restore tools**, which runs `ef-restore`. It may download packages, but only on that click (like a Dependencies check).

## Migration list (`ef-parse.ts`)

- The `data:` lines are joined and parsed as JSON: an array of `{ id, name, applied }`. EF also prints `safeName`, which is dropped. `applied` is `true`, `false` or `null` when EF couldn't reach the database.
- Each `id` must match `^\d{14}_[A-Za-z_][A-Za-z0-9_]*$` and each name must be an identifier; a row that doesn't is dropped. At most 1,000 rows.
- An unparseable result keeps the previous list and logs `■ Couldn't read the migration list`.
- The list lives in memory per package and context. It is never stored. It belongs to the environment it was read for: switching the environment or context clears it until the next List.

## Contract

- **Status:** `status({ environment?, context? })` adds `ef: { tool, contexts, context, needsRestore, migrations } | null`:
  - `tool`: `'local' | 'global' | null`;
  - `contexts`: `string[]`, the found names;
  - `context`: the one in use (null when none is found);
  - `migrations`: `{ environment, items: { id, name, applied }[] } | null` (null until listed for this environment and context).
- **Running:** `running.command` gains the EF kinds (`ef-list`, `ef-add`, `ef-update`, `ef-script`, `ef-remove`, `ef-restore`).
- **New methods:** `ef({ action, environment, context?, name?, target?, confirmed? })`, one method so the shared checks live in one place. `action` is `list`, `add`, `update`, `script`, `remove` or `restore`.
  - `environment` must match `ENVIRONMENT_NAME`.
  - `context` must be one of the found names (else VALIDATION).
  - `name` is required for `add` and must match `^[A-Za-z_][A-Za-z0-9_]{0,99}$`.
  - `target` (update only) is `0` or an id from the current list; anything else is VALIDATION.
  - `confirmed: true` is required for `update` when the environment isn't `Development` (case-insensitive), for any `update` with a `target` (it can roll back), and for `remove`. Without it the call is VALIDATION, so the renderer must ask first.
  - `restore` is accepted only when `tool` is `local`.
  - Without a tool, or with `status.ef` null, the call is NOT_FOUND.
- **Unchanged:** `stop({ what: 'command' })`, `getLogs` and `clearLogs` serve EF runs too.
- **Logs:** `database ef` with the project id, action, exit code and the list's row and pending counts. Never names, ids, output or paths.

## UI

- **EF Core card:** under Connections, built like the Prisma card.
  - **Header:** the title, `local tool` or `global tool`, and a context select when there are several.
  - **Buttons:** List migrations · Add migration… · Update database · Script SQL · Remove last · Stop (while a command runs). They're disabled while any command runs.
  - **Environment:** the Connections card's select (one state in the panel). Each confirm dialog names it.
- **Migration list:** after a List, it shows newest first, with a dot (applied green, pending amber, unknown grey) and the name and date from the id. An applied row that isn't the newest applied has **Update to here** (a roll back). The list ends with **Revert all** (`target: 0`). Before any List, the card says "List migrations to see which are applied."
- **Dialogs:**
  - **Add migration:** a name field, checked as you type.
  - **Update database** (when not Development): "Apply pending migrations to the <Env> database?"
  - **Update to here / Revert all:** "Roll the <Env> database back to <Name>? Later migrations' Down steps run and can drop data."
  - **Remove last:** "Remove the last migration's files from the project?"
- **Log:** the Database log under the cards, titled "EF Core" when Prisma isn't there (both share one log in a package with both).
- **Overview card:** `N pending migrations` (amber) once a list has been read; nothing before.
- **No tool:** the card shows only the install hint. The Connections card is unchanged.

## Tests

- **Unit (main):**
  - **Context scan:** generic and qualified bases, comments, abstract classes, duplicates, the cap, `bin/obj` skipped.
  - **Tool lookup:** a manifest in the folder, in a parent, without `dotnet-ef`, unreadable; global; none.
  - **`ef-parse`:** real `migrations list --json --prefix-output` output captured from dotnet-ef 10.0.0 (applied true and false, with the app's SQL logging in between; applied null after a database error) and dotnet-ef 8.0.27 (with its version warning), and the real "not restored" message. Also bad ids, non-JSON output and the cap.
  - **Argument builder:** context, target, environment and project file; never `--connection`/`--verbose`/`--force`.
  - **Handlers with a fake platform:**
    - spawn arguments and env;
    - CONFLICT with a running Prisma or EF command;
    - the `confirmed` rules, an unknown context or target, `restore` only for a local tool;
    - the follow-up list, `needsRestore`, the 10-minute stop;
    - no EF output in `deps.logger` calls.
- **Detection:** `efDesign` from PackageReferences.
- **Renderer:**
  - the card with and without a tool;
  - the context select, list rows and the pending count on the overview card;
  - the add dialog's validation;
  - the confirmations (Production update, roll back, remove), and none for a Development update.
- **End-to-end:** `fake-dotnet` learns `ef`: list (JSON with prefixes), add (appends to its state), update, remove, script and tool restore. Each call is logged to `.fake-dotnet.log`. The `dotnet-app` fixture gains the Design reference, a `ShopDbContext.cs` and a `.config/dotnet-tools.json`. One spec:
  1. lists two migrations, one pending;
  2. adds `AddOrders`;
  3. switches to Production and updates after the confirmation;
  4. checks the calls (`--project`, `-- --environment Production`, never `--connection`) and the log. That NestBox's own logs carry no EF output is pinned by the handler tests.

## Docs and version

- **CLAUDE.md:** a Database gotcha for EF Core.
- **README:** the Database row and a v1.26.0 roadmap row, with #45 under Planned.
- **HANDOFF.md** and `package.json` 1.26.0.

## Out of scope

- Interactive input to running commands, and Prisma's `migrate dev` inside NestBox (#45).
- `dbcontext scaffold`, `dbcontext optimize`, bundles (`migrations bundle`) and `database drop`.
- Choosing the startup project (`--startup-project`): the package's own project is used.
- A login test: the Connections card's reachability check covers "does it answer".
