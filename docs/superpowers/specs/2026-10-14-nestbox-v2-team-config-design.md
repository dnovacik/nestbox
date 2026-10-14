# NestBox v2: team config in `.nestbox.json` (design)

Issue #87. **Status: design, for the owner's review.** The implementation plan follows approval (`docs/superpowers/plans/`).

## Goal

A teammate clones a repo, adds it to NestBox, accepts its team config once, and has the same custom commands, run groups, health checks, mock routes and local domain names as everyone else, without setting anything up.

The owner's choices (2026-10-14):

| Question | Decision |
| --- | --- |
| Who it's for | Teammates on the same repo |
| What it carries | Commands and run groups (custom commands, main command, env file per command, hidden detected tasks, run groups with their Compose services); health checks; mock routes; local domain names and the Host rewrite |
| Editing | Local by default: the file is the team baseline, your edits are personal overrides, and an explicit **Share with the team** writes an item into the file |
| Trust | Shown and accepted once per file content; nothing from an unaccepted file is used |
| Approach | One merged view at the settings boundary (a `TeamConfig` layer), not a second layer per tool and not copying on accept |

**Out of scope:** machine-specific settings (fnm, the terminal, ports, static servers, auto-restart, notifications, mock ports/delays/fail toggles); NestBox running git; files in workspace packages (the root's file covers them by `package` relPath).

## 1. The file

`.nestbox.json` at the root project's folder. JSONC (comments and trailing commas allowed), at most 256 KiB, `"version": 1`. Packages are addressed by `package` (the relPath; `""` = the root), never by NestBox project ids, which differ per machine.

```jsonc
{
  "version": 1,
  "commands": [
    { "package": "", "name": "api", "argv": ["dotnet", "watch", "--project", "src/Api"] }
  ],
  "main": { "": "dev", "packages/api": "api" },
  "envFiles": [{ "package": "", "name": "api", "file": ".env.local" }], // null = none
  "hidden": { "": ["ci"] },
  "runGroups": [
    {
      "name": "Full stack",
      "entries": [{ "package": "", "script": "dev" }, { "package": "packages/api", "script": "api" }],
      "compose": [{ "package": "", "services": ["db"] }]
    }
  ],
  "health": {
    "packages/api": {
      "intervalSec": 30,
      "checks": [{ "id": "api-up", "kind": "env", "key": "API_URL", "path": "/health" }]
    }
  },
  "mock": {
    "": { "routes": [{ "id": "users", "method": "GET", "path": "/api/users", "body": "[]" }] }
  },
  "domains": { "names": { "": "shop", "packages/api": "api" }, "rewriteHost": { "packages/web": true } }
}
```

**Validation.**
- Every section is validated with the item schemas the tools already use: `CustomCommandSchema` (argv rules: no `"`, CR, LF, NUL or leading `KEY=value`), `RunGroupSchema`, Health's `StoredCheckSchema` (URLs with credentials refused), Mock's `RouteSchema`, and domains' `LABEL`. The file's `package` maps to the tools' `relPath`.
- A section that fails validation is **dropped on its own**, with a warning naming the section and the item index. The rest of the file still counts.
- Each section has a cap. Where the store has one, it's the same: 100 commands, 20 health checks per package, 100 mock routes per package. Run groups have no cap in the store, so the file gets a new one of 50.

**Not in the file:** anything listed under Out of scope. Unknown top-level keys are ignored, with a warning.

## 2. Reading, trust and merging

### Reading (`src/main/team-config/`)

- **When:** the service reads a root project's file when the project is added or refreshed, and on change. It watches the root folder for that file name, with 300 ms of quiet, and only for projects that are present.
- **How:** it parses with `jsonc-parser` and validates per section.
- **Identity:** the **hash of the validated content in canonical JSON** (sorted keys, defaults applied). Reformatting or editing comments doesn't change it; any item change does.

### Trust states (per root project)

| State | Meaning | Used content |
| --- | --- | --- |
| `none` | no file | — |
| `pending` | the file exists, and this hash was never accepted | nothing |
| `accepted` | the hash equals the accepted one | the file |
| `changed` | you accepted an earlier hash; the file now differs | **the last accepted snapshot** until you review |
| `ignored` | "Never for this project" | nothing |
| `invalid` | not JSONC, not an object, an unknown `version`, over 256 KiB, unreadable | the last accepted snapshot if any, else nothing |

**Storage:**
- `Project.teamConfig: { acceptedHash: string | null, ignored: boolean, hidden: Record<section, string[]> }`, added with a Zod default, so the store stays at v2. `hidden` holds the user's local hides of team items (§2 writes).
- The accepted snapshot (validated content) goes in `userData/team-config/<projectId>.json`, written atomically.
- Removing the project deletes both.

### Review

`teamConfig:review` returns what the file defines, item by item:
- commands with their **full argv**;
- the main command and env file per package, and hidden tasks;
- run groups with their entries and Compose services;
- health checks (URL, or env key and path, plus the interval);
- mock routes (method, path, status);
- domain names and the Host rewrite.

In the `changed` state it returns only what was **added, changed or removed** against the snapshot. Accepting takes the hash the user reviewed: `teamConfig:accept { projectId, hash }`, which answers CONFLICT if the file changed since the review.

### Merging

Each tool's settings and the two non-tool sources are read as **team ∪ local**, merged per item by its key:

| Section | Store it merges with | Key | Rule |
| --- | --- | --- | --- |
| commands | `toolSettings.scripts.commands` | `package/name` | local overrides |
| envFiles | `toolSettings.scripts.envFiles` | `package/name` | local overrides |
| main | `toolSettings.scripts.main` | `package` | local wins |
| hidden | `toolSettings.scripts.hidden` | `package` | union |
| runGroups | `Project.runGroups` | name | local overrides |
| health | `toolSettings.health.packages` | `package/id` per check; `intervalSec` per package | local overrides / local wins |
| mock | `toolSettings.mock.packages[…].routes` | `package/id` | local overrides (ports, delay, fail stay local) |
| domains | `AppSettings.domains.names` / `rewriteHost` | `package` → project id | local wins |

A team command whose name clashes with a package.json script or a detected task follows the existing rule: package.json wins, then detected, then custom.

### Writes through the merged view

`ctx.settings.update(fn)` (and `runGroups.set`, the domains name and rewrite setters) receive the merged view. The layer splits the result back:
- An item **equal** to its team version isn't stored locally.
- A **changed** item is stored as a local override.
- A **deleted** team item is stored as a local **hide** of its key, in `Project.teamConfig.hidden[section]`, restorable.
- **Writes never touch the file.** Only the explicit share actions in §3 do.

**Origins.** The layer exposes `origins(section)` (key → `team` | `local` | `override`). Tools add an `origin` field to the items they return to the renderer: the Scripts list rows, run groups, Health checks and Mock routes. The domains status routes carry the origin of their name.

**Where it sits.** The layer wraps `ProjectService.getToolSettings/setToolSettings`, the Scripts tool's `runGroups.get/set`, and the domains service's settings access. Tools keep their storage code; each one only adds `origin` to its outputs.

## 3. Sharing and editing

| Item origin | Actions |
| --- | --- |
| `local` | **Share with the team**: write it into the file, then drop the local copy |
| `override` | **Share my version**: replace the team's item in the file. **Reset to team**: drop the override |
| `team` | **Hide for me**: a local hide. **Remove from team config**: edit the file, after a confirmation |
| hidden team item | **Restore** |

**Writing the file.**
- **Version check:** every write goes through `fs/versioned-file` with a version token. If the file changed since NestBox read it (e.g. after a `git pull`), the write is a **CONFLICT**; the UI re-reads, and the user retries.
- **Formatting kept:** edits go through `jsonc-parser`'s `modify`/`applyEdits`, the same approach as the Env tool's appsettings editor. Comments, ordering, trailing commas, line endings and a BOM stay byte-identical outside the changed item.
- **Creating the file:** the first share creates `{ "version": 1, … }` with the platform's line endings. NestBox never runs git.
- **Item shape:** items are written in the file's shape, with `package` instead of project ids and default-valued fields left out. Health checks and mock routes keep their existing `id`.
- **Auto-accept:** after NestBox's own write, the new hash is accepted automatically, since the change is the user's.
- **Refusals:** sharing is refused while the state is `pending`, `changed` or `invalid`, because writing and then auto-accepting would accept unreviewed content. The UI says "Review the team config first". A symlinked file is readable but never written; sharing answers FORBIDDEN.

## 4. UI, IPC, errors

### UI

- **Banner** on the project (`pending` or `changed`): "This repo has a team config (4 commands, 1 run group, 2 checks)" with **Review**. In the `changed` state it reads "The team config changed (1 added, 1 changed)". In the `invalid` state it reads "The team config can't be read: <reason>".
- **Review dialog:**
  - items grouped by section, command lines in monospace and complete (never truncated), and the diff in the `changed` state;
  - buttons **Use team config**, **Not now** and **Never for this project**.
- **Origin badges:**
  - "team" or "yours" on items in Scripts (custom commands), Run groups, Health checks and Mock routes, and in the Local domain dialog;
  - a "Hidden team items" list with Restore, like today's hidden detected tasks.
- **Share actions** go in each item's existing row menu (§3).
- **Project menu → Team config…:** the state, Review, "Never for this project" and "Use it again".
- **Project info card:** a line such as "Team config: accepted · 6 items" or "pending review".

### Core channels

| Channel | Input → output |
| --- | --- |
| `teamConfig:status` | `{ projectId }` → `{ state, hash, counts, warnings: { section, index?, reason }[] }` |
| `teamConfig:review` | `{ projectId }` → `{ hash, items, diff \| null }` |
| `teamConfig:accept` | `{ projectId, hash }` → status (CONFLICT when the hash is stale) |
| `teamConfig:ignore`, `teamConfig:unignore` | `{ projectId }` → status |
| `teamConfig:share`, `teamConfig:removeShared`, `teamConfig:resetOverride`, `teamConfig:hide`, `teamConfig:restore` | `{ projectId, section, key }` → status |
| event `teamConfig:changed` | `{ projectId }`: the renderer refetches the status and the affected tool queries |

`section` is an enum of the §1 sections. `key` is validated per section: a relPath, a name, or an id within the schema limits.

### Errors

| Case | Behaviour |
| --- | --- |
| Not valid JSONC, or the root isn't an object | `invalid`; the review shows the parse error's line and column, never content |
| A section fails validation | the section is dropped, with a warning (section name and item index) |
| Unknown `version` | `invalid`: "made by a newer NestBox" |
| Over 256 KiB, or unreadable | `invalid` with the reason |
| Symlinked file | read; sharing refused (FORBIDDEN) |
| A write after the file changed | CONFLICT; the UI re-reads, and the user retries |
| Read-only store | review and accept work in memory for the session; the UI says the choice can't be saved |

**Logs** carry section names, counts, states, hashes (first 8 characters) and codes. Command lines, URLs, env keys, route bodies and domain names are repo content: they're shown in the UI but never logged (the CLAUDE.md privacy rules).

## 5. Testing

- **Unit:**
  - parsing and per-section validation, including the caps and the warnings;
  - canonical hashing: a comment or whitespace edit keeps the hash, an item edit changes it;
  - merge and split for every section: overrides, hides, an item equal to the team's stored as nothing, the name-clash rule;
  - the trust state machine: `pending` uses nothing, `changed` keeps the snapshot, `invalid` falls back, sharing is refused unless `none` or `accepted`, and a stale `accept` gets CONFLICT;
  - the writer: formatting stays byte-identical, creating the file, CONFLICT, refusing to write through a symlink;
  - package relPath ↔ project id mapping for domains.
- **Renderer:** the banner states, the review dialog (full command lines, the diff), the origin badges, the share actions and their refusals.
- **End to end:**
  - a fixture repo with `.nestbox.json` shows the banner and no team command;
  - **Use team config** makes the command appear and it runs;
  - **Share with the team** on a local command adds it to the file;
  - editing the file on disk shows `changed`, and the old command keeps working until reviewed.

## Delivery

One PR, **v1.31.0**: CLAUDE.md gets a "Team config (v1.31)" gotcha, the IPC line and the folder table entry; the README gets its feature table and roadmap rows; issue #87 closes.
