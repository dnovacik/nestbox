# NestBox v2: Nx workspaces, and npm + NuGet in one folder (design)

**Status: built (2026-10-14).**

The rest of the Node batch that ships as 1.29.0 with #63. Owner's choices (2026-10-14): Nx support covers the root's run-many tasks **and** project.json-only projects as packages; the Dependencies tool checks every ecosystem of a folder that is both Node and .NET.

## Part 1: Nx (#76)

An Nx workspace keeps targets in `project.json` files and in package.json scripts, and plugins in `nx.json` infer more. NestBox reads files only: inferred targets aren't listed (no `nx show` at detection).

**The Nx root.** A root with `nx.json` whose package.json lists `nx` in dependencies or devDependencies (installed by the workspace, so NestBox never downloads it). `ecosystems/node/nx.ts` reads, capped and names only:

- `nx.json` (JSONC, 64 KiB): `targetDefaults` keys;
- every Nx project's `project.json` (64 KiB each, at most 200 projects): its `name` and `targets` keys.

Target names must be plain words (the `PLAIN` rule from `monorepo.ts`; `build:prod` style passes, `^build` and anything with `{` don't). `Monorepo` gains `nx: string[]` (targetDefaults keys and project targets, sorted, at most 20), and a root is a monorepo when it declares workspaces **or** is an Nx root.

**Root tasks.** `nx:<target>` → `nx run-many -t <target>` through the package manager, like turbo: `npm exec --no -- nx`, `pnpm exec nx`, `yarn nx`, `bun run nx`.

**Nx projects as packages.** The Node module's `workspaceDirs(root)` returns, on an Nx root, the folders holding a `project.json` (tinyglobby, up to 4 levels down, skipping `node_modules` and dot, build and output folders, at most 200), so libraries without a package.json appear under the root like any workspace package. Folders that also have a package.json are found either way; the set is de-duplicated.

**A project's Node entry.** `detectNode` now also answers for a folder with `project.json` and no `package.json` when the root is an Nx root (`ctx.root`). `NodeInfo` gains:

- `packageJson: boolean`: whether the folder has its own package.json. Dependencies and Deploy apply only when it does (a project.json-only library has nothing of its own to install or deploy). Scripts, the Node tool and run environments apply as before.
- `nx: { project: string; targets: string[] } | null`: the project's Nx name (project.json `name`, else package.json `name`) and its project.json targets (plain words, at most 30). Set only under an Nx root; names must match `^@?[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9._-]+)?$` (npm-style), else null.

The display name of a project.json-only folder is its Nx name. The manager is the root's (as for every workspace package).

**Project tasks.** `nx:<target>` → `nx run <project>:<target>` through the package manager, for each target the project.json lists. A package.json script of the same name still runs as an npm script; the `nx:` prefix keeps the names apart.

**Not in scope.** Inferred (plugin) targets; `nx affected`; Nx Cloud. A later "Read targets from Nx" button could run `nx show project` on demand.

## Part 2: npm and NuGet in one folder

Today a folder that is both Node and .NET (an ASP.NET app with a front end) gets one result: Node's. Now every ecosystem with a check gets its own.

- `PackageResult` gains `ecosystem` (`EcosystemId`; a Zod default from `manager`, `dotnet` → `dotnet` else `node`, so old cache files still parse).
- The cache keys results by `projectId` + ecosystem (`<id>#<ecosystem>`); `get(id)` becomes `forPackage(id)` (every ecosystem's result, Node first). The file's `version` stays 1: old keys are plain ids, read as the `node`/`dotnet` result their `manager` says.
- `check` runs each ecosystem's `deps` in a folder in module order (Node first), one at a time.
- `copyUpdateCommand` takes an optional `ecosystem` to pick the row's result when both list the same name.
- The panel and the Dependencies page show one section per result: the package name plus the manager when a folder has more than one (`shop · npm`, `shop · NuGet`). `summarize` already counts rows over any list of results.

## Order

Two PRs, both staying at 1.29.0 (no release until both are in): Nx first, then mixed dependencies. Each updates CLAUDE.md and extends the README's 1.29.0 row; #76 closes with the first.
