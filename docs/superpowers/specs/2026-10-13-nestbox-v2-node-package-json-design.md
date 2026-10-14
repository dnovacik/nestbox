# NestBox v2: package.json data from the Node module (design)

Issue #63, left over from #47. Since 1.28's Node work, the Node module already reads `package.json` once per folder (`ecosystems/node/package-json.ts`) for the `packageManager` field, dependency names (framework, `hasDependencies`), the dev and start scripts (ports) and, on a monorepo root, its packages' script names. Generic detection still reads the same file for `DetectedProject.packageJson` (name and scripts), and `DetectedProject.packageManager` is still computed outside the module. Tools read those two fields directly. This is the last Node-only path outside `ecosystems/node/`, so a Python or Go package can't take part in it the same way.

**Status: approved (2026-10-14).** See the decisions at the end.

## Where the fields are read today

| Field | Readers |
| --- | --- |
| `packageJson.scripts` | Scripts tool (`npm` rows), Deploy (Ready to deploy's script picker and its known-script check), Claude tool (context block), renderer: palette entries, Project info (panel and card) |
| `packageJson.name` | detection (the package's display name) |
| `packageJson !== null` | `appliesTo` of Node, Dependencies, Deploy, Scripts; `isPackage` in `shared/detected.ts` |
| `packageManager` | ProcessManager (`<pm> run <script>`, through `StartRequest`), Scripts tool, Database (Prisma through the manager), Deploy (CLI through the manager), Claude context, renderer: project header, Project info |

Most readers are in main, but four are in the renderer. The renderer can't parse `NodeInfo` today: its schema lives in `src/main/ecosystems/node/detect.ts`.

## Proposal

1. **NodeInfo owns the data.** Add `name` and `scripts` (`Record<string, string>`, same rules as today: string values only) to `NodeInfo`, from the read the module already does. Detection no longer reads `package.json` itself; the package's display name comes from the Node entry, else the folder name. One read per folder instead of two.
2. **A shared schema.** Move `NodeInfoSchema` (and `FrameworkSchema`, `MonorepoSchema`) to `src/shared/ecosystems/node.ts`, so main and the renderer parse the same shape. The main module re-exports it. Zod stays out of the preload; the renderer already bundles Zod.
3. **One accessor.** `nodeOf(project): NodeInfo | null` in `src/shared/ecosystems/node.ts` parses the project's `node` entry (a `safeParse`, cached per object in a `WeakMap`). Every reader above calls it: `nodeOf(p)?.scripts ?? {}`, `nodeOf(p)?.packageManager ?? null`. "Is a Node package" becomes `nodeOf(p) !== null`.
4. **The manager stays one rule.** `DetectedProject.packageManager` today is null without a lockfile or field, and `NodeInfo.packageManager` is `npm` then (with `packageManagerSource: 'default'`). Readers that want "what runs scripts" take `nodeOf(p)?.packageManager`, which gives the same result, since null meant npm everywhere. The project header and Project info, which show "none" for null, show `npm (default)` from `packageManagerSource`.
5. **Migration in two PRs, no behaviour change.**
   - **PR 1:** add `name`/`scripts` to `NodeInfo`, the shared schema and `nodeOf`, and move every reader to it. `DetectedProject.packageJson` and `.packageManager` stay, filled from the Node entry (`detectProject` copies them), with a `@deprecated` note, so stored data and the e2e fixtures keep working. Tests: each reader's existing tests, plus one test that the copied fields equal `nodeOf`'s.
   - **PR 2:** remove the two fields from `DetectedProject` and its Zod schema (the store keeps projects, not detection results, so there's no migration), `makeDetectedForTest` takes `ecosystems` instead, and the screenshot script and fixtures follow.
6. **appliesTo by capability, later.** Scripts already applies to `ecosystems.length > 0`. Dependencies and Deploy could ask "has dependencies" or "has scripts" through module capabilities (`deps`, `tasks`) instead of `nodeOf(p) !== null`. Not needed for this change: `nodeOf` keeps today's behaviour.

## Out of scope

- Other ecosystems' package files (pyproject.toml, go.mod): this only makes room for them.
- Reading more of `package.json`: values stay where they are used (version sources in `version-check.ts`), names only in detection.

## Decisions (2026-10-14)

1. **Two PRs:** deprecate and copy first, then remove.
2. **Header and Project info show `npm (default)`** when no lockfile or `packageManager` field names a manager. This is the one visible change in PR 1.
3. **Order:** after 1.28.0, which is published.
