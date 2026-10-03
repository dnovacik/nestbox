# NestBox v2 (TODO scanner): Design Notes

Date: 2026-10-03
Status: Draft, waiting for approval
Source of truth: `docs/nestbox-spec.md`, "v2 tools", which describes the TODO scanner as: *`TODO`/`FIXME`/`HACK` comments grouped by file, linked via `vscode://file/...`; respects `.gitignore`.* These notes build on the earlier design notes and don't restate them.

## Scope

The third v2 tool. It ships alone as **v1.4.0**, from the branch `v2-todos`, in one PR.

**Owner's answers (2026-10-03):**
- The file list comes from git when the folder is in a repository, and from a folder walk with `.gitignore` support otherwise.
- The tags default to TODO, FIXME, HACK, XXX and BUG, and a per-project setting can change them.
- It scans when the tab or card first appears in a session, then only on Refresh, and keeps the results in memory.
- A click opens the file at that line in NestBox's editor, not a `vscode://` link.

**Not in this release:**
- Editing or resolving TODOs from NestBox.
- Blame or age per TODO.
- Live watching.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Tool | Id `todos`, name "TODOs", lucide `list-todo`. `appliesTo: () => true`: every package has source. A workspace package scans only its own folder; the root package scans its whole tree, workspace packages included, as git lists it. |
| 2 | File list (git) | `git ls-files -z --cached --others --exclude-standard` with `cwd` set to the package folder, through `ctx.platform.execCommand` (`maxBytes` 8 MiB, 20 s). It lists tracked and untracked-but-not-ignored files under the folder, applying every `.gitignore`, `.git/info/exclude` and the global excludes exactly as git does. Exit 128 (not a repository) or git missing falls back to D3. Submodules are listed as folders and skipped. |
| 3 | File list (walk) | `tinyglobby` (already a dependency) walks `**/*` with `dot: true`. It skips `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `.nuxt`, `coverage`, `.turbo` and `.cache` at any depth, and applies the package's own `.gitignore` with the `ignore` package (new runtime dependency, 1 file, no dependencies of its own; already in the lockfile through eslint). Nested `.gitignore` files are not read by the walker; git mode covers them. |
| 4 | Limits | At most 20,000 files and 5,000 matches. Files over 1 MiB, files with a NUL in their first 8 KiB, and a fixed list of binary extensions (images, fonts, archives, media, `.lock`-style lockfiles, `.min.js`, `.map`) are skipped without reading further. Reads run 16 at a time. The whole scan has 30 s; when any limit is hit, the result says which (`truncated: 'files' \| 'matches' \| 'time'`), and the panel shows it. |
| 5 | What matches | A tag counts only after a comment marker on the same line: `//`, `#`, `/*`, `*` (a JSDoc line), `<!--`, `--` (SQL and Lua), `;` (INI and Lisp) or `{/*` (JSX). The tag is a whole word (case-insensitive) and is followed by `:`, `(…)`, whitespace or the end of the line. So `// TODO: x`, `# fixme`, `/* HACK(dan) */` and ` * XXX` match, while `todoList`, `"TODO"` in a string and `TODOS` don't. The text is the rest of the line, with any closing `*/`, `-->` or `}` removed, trimmed and capped at 300 characters. `TODO(name)` keeps the name as `owner`. |
| 6 | Tags setting | `settingsSchema`: `{ tags: string[] }`, defaulting to `['TODO', 'FIXME', 'HACK', 'XXX', 'BUG']`. There are 1–20 tags, each matching `^[A-Za-z][A-Za-z0-9_]{1,19}$` and stored upper-cased. It is edited in the panel as chips with a small "Add tag" input; a change invalidates the cache and rescans. |
| 7 | Cache and scans | One result per package in memory, never stored on disk. `results` returns the cached result or null. `scan` runs a new scan; a second call while one runs joins it. The renderer calls `scan` when `results` is null (the first view in a session) and on Refresh. A removed project drops its cache. |
| 8 | Opening | `openFile({ path, line })` validates the relative path the same way as the git tool's `openFile` (no absolute paths, no `..`, inside the package). The shared check moves to `src/main/fs/inside.ts`, and the git tool uses it too. Then `ctx.platform.openInEditor(abs, line)` runs: VS Code's `-g file:line` and the macOS `vscode://` fallback already handle lines. |
| 9 | Privacy | TODO text is project file content. It is sent to the renderer for display only, kept in memory and never logged or stored. The logger records the source (git/walk), file count, match count, truncation and duration. |
| 10 | Overview card | "TODOs": the total, a count per tag (`FIXME 3 · TODO 12`), "scanned 5 min ago", and "Open TODOs". If the session has no result yet, the card starts the first scan itself, which is the "on open" in the owner's answer. |
| 11 | Panel | A header with the total and Refresh; the tag setting chips; a filter row with one toggle per tag and a text search over paths and text. Below that, the files, collapsible, sorted by path, with their matches: line number, the tag as a coloured badge (FIXME/BUG `err`, HACK/XXX `warn`, others `brand`), the text, and the owner. A click opens the file at that line. The list is virtualised with react-virtual once it has more than 200 rows. |
| 12 | Version | 1.4.0, released with the same flow as the earlier v2 releases. |

## Contract (sketch)

```ts
const Todo = z.object({ path: z.string(), line: z.number().int().positive(), tag: z.string(), text: z.string().max(300), owner: z.string().nullable() });
const TodoScan = z.object({
  scannedAt: z.number(),
  source: z.enum(['git', 'walk']),
  files: z.number().int(), // files read
  todos: z.array(Todo).max(5000),
  truncated: z.enum(['files', 'matches', 'time']).nullable(),
  durationMs: z.number(),
});
// methods: results({}) → TodoScan | null, scan({}) → TodoScan, openFile({ path, line }), getTags({}) → string[], setTags({ tags }) → string[]
```

## Testing

- **Unit tests:**
  - `matchLine` cases for every comment style, plus non-matches (identifiers, strings, plurals) and the owner;
  - `parseLsFiles` (`-z` output, truncated output);
  - the walker's skip list and root `.gitignore` handling on a temporary tree;
  - binary and size skips;
  - the limits;
  - the scan join;
  - the tags schema;
  - `openFile` validation through the shared `inside.ts`, whose git tool tests still pass.
- **Integration (real git):** a temporary repository where a `.gitignore`d file containing a TODO is not reported, while an untracked TODO is.
- **Renderer tests:**
  - the card: first scan, counts and stale time;
  - the panel: grouping, tag filter, search, Open with line, and tag edits.
- **End-to-end:** a fixture with TODOs in `.ts`, `.py` and `.md` files plus a `.gitignore`d `dist/`. The card counts them, the panel lists them by file, and Open calls the editor stub.
