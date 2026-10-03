# NestBox v2 (Git glance): Design Notes

Date: 2026-10-03
Status: Approved 2026-10-03
Source of truth: `docs/nestbox-spec.md`, "v2 tools": *Git glance: branch, uncommitted count, ahead/behind, last commit; read-only on the overview card.* These notes build on the M0–M3 and macOS design notes and don't restate them.

## Scope

The first v2 tool. It ships alone as **v1.2.0**, from the branch `v2-git-glance`, in one PR.

**Owner's answers (2026-10-03):**
- Git glance is the next tool.
- It never contacts the remote. Ahead and behind are counted against the last-fetched upstream ref and labelled with the time of the last fetch.
- It refreshes when `.git` changes (a debounced watch) and when the NestBox window regains focus.

**What it shows:**
- **On the overview card:**
  - the branch (or the detached commit);
  - a merge, rebase, cherry-pick, revert or bisect in progress;
  - the number of uncommitted changes;
  - ahead and behind the upstream, with the time of the last fetch;
  - the last commit: subject, author and age.
- **In the panel:** the same summary, plus the changed files grouped as Conflicts, Staged, Changes and Untracked. Each file has an "Open" button that opens it in the editor.

**Not in this release:**
- No git writes of any kind: no fetch, pull, commit, stage or checkout.
- No diffs, file contents, stashes or history beyond the last commit.
- No status for workspace packages of their own (they share the root's repository).

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Which projects | `appliesTo: (p) => p.git !== null`. Detection already sets `git` only for a folder that has its own `.git` (a directory, or a file pointing to a worktree's gitdir). Workspace packages have `git: null`, so the tool appears on the root project only. A project folder that sits *inside* a repository, without its own `.git`, gets no Git tab. That case is rare for the roots NestBox adds and can come later. |
| 2 | Git calls | Two calls per refresh, both through `ctx.platform.execCommand` (cmd.exe on Windows, the login-shell `PATH` on macOS): `git --no-optional-locks status --porcelain=v2 --branch -z --untracked-files=normal`, then `git --no-optional-locks cat-file commit HEAD` (skipped when the branch has no commits yet). No argument contains `%` or `"`, so everything passes `cmdInvocation` unchanged; `--format=%…` strings are avoided because cmd.exe could expand them. `--no-optional-locks` keeps git from rewriting the index, so a status run never triggers the `.git` watch (D5) or contends with the user's own git. |
| 3 | Parsing status | A pure `parseStatus(stdout, truncated)` reads porcelain v2: the `# branch.oid`, `# branch.head`, `# branch.upstream` and `# branch.ab +A -B` headers, and the `1`, `2` (rename or copy, followed by a NUL and the original path), `u` (unmerged) and `?` records. Counts: staged (X ≠ `.`), unstaged (Y ≠ `.`), untracked and conflicted; `total` counts each path once. Paths may contain spaces: the path is everything after the record's fixed fields. |
| 4 | Large repositories | `execCommand` gains an optional `maxBytes` (both adapters pass it to the runner). Status runs with a 2 MiB cap and a 10 s timeout. When the output fills the cap, the last, possibly cut, record is dropped and `truncated: true` is returned: the card shows "2 000+ changes". The panel lists at most 500 files, plus a "and N more" line. |
| 5 | Watching `.git` | Started by the first `status` call (the tool host never calls `activate`, as for env). It watches the gitdir (not recursively) and `<commondir>/refs` (recursively), which covers HEAD, index, packed-refs, FETCH_HEAD, MERGE_HEAD, branch and remote refs. `*.lock` file names are ignored. Events are coalesced: one `changed` event (no payload) at most every 1 s, sent 300 ms after the last change. The gitdir and commondir come from `resolveGitDirs(dir)`, which is split out of detection's `git-head.ts` (it follows the `gitdir:` pointer and the `commondir` file of a linked worktree). The watcher stops in `dispose` and `forgetProject`, and restarts when the project's path changes. A folder that can't be watched retries on the next `status` call. |
| 6 | Focus refresh | Electron doesn't change `visibilityState` when another app takes focus, so TanStack's focus refetch wouldn't fire (and it is off app-wide). Instead, the renderer hook listens for `window` `focus` and invalidates the git status queries. Combined with D5, this catches working-tree edits made in an editor without watching the whole tree. The panel also has a Refresh button. |
| 7 | Ahead/behind and the last fetch | Taken from `# branch.ab` against the configured upstream, with no network access. `lastFetchAt` is the mtime of `<commondir>/FETCH_HEAD` (null if git has never fetched); the card says "as of fetch 3 h ago". No upstream shows "No upstream". A detached HEAD shows "Detached at abc1234". |
| 8 | Operation in progress | `MERGE_HEAD`, `rebase-merge/` or `rebase-apply/`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` and `BISECT_LOG` in the gitdir, checked in that order: a badge such as "Rebasing". These are stat calls only. |
| 9 | Last commit | Parsed from `git cat-file commit HEAD` (the raw object): the `author Name <email> <epoch> <tz>` header, then the first line of the message after the blank line. The `gpgsig` and other continuation headers are skipped. The email is dropped. The output is `{ hash (7 chars, from branch.oid), subject, author, at }`, or null on a repository with no commits. |
| 10 | States and errors | The output is a discriminated union. `ok` carries the summary. `git-missing` means git is not installed (the run failed and `platform.commandExists('git')` is false): the card says "Git is not installed". `not-a-repo` means exit 128, which includes git's "dubious ownership" refusal: the card says git can't read the folder (NestBox never adds a `safe.directory` override). `failed` means a timeout or another exit code: the card shows "Couldn't read git status" and Retry. None of these are IPC errors, so the overview never shows a red toast. |
| 11 | Opening a file | `openFile({ path })` takes a path relative to the repository root, as status printed it. It rejects absolute paths, `..` segments and NUL with VALIDATION, then resolves the path inside `project.path`. The file must exist (a deleted file gives NOT_FOUND, and its row has no Open button). Then `ctx.platform.openInEditor(abs)` runs; on Windows the existing cmd checks still apply, so a name with `"` gives VALIDATION. |
| 12 | Privacy | Commit subjects, author names and file names travel to the renderer for display and are never logged or stored. File contents and diffs are never read. The logger records tool, method and codes only, as for every tool. |
| 13 | UI | **Card** ("Git", lucide `git-branch`): the branch in mono, an operation badge, "Clean" or "N changes" (with staged and conflicted counts when non-zero), `↑A ↓B origin/main` plus "fetched 3 h ago", and the last commit subject (truncated, with the full text in a tooltip), its author and age. **Panel:** the same header plus the grouped file lists, with each row showing a status letter, the path (the original path for renames, as "old → new") and an Open button. Colours come from tokens: conflicts use `err`, staged uses `ok`, modified uses `warn` and untracked is muted. Relative times use the existing formatter if one exists, otherwise a small `relativeTime` helper in `lib/`. |
| 14 | Version | `package.json` becomes 1.2.0. The release follows the v1.1.0 flow: merge, run release.yml on `main`, and the owner publishes the draft. |

## Contract (sketch)

```ts
const ChangeKind = z.enum(['conflicted', 'staged', 'modified', 'staged-modified', 'untracked', 'deleted']);
const GitFile = z.object({ path: z.string(), origPath: z.string().nullable(), kind: ChangeKind, exists: z.boolean() });
const GitStatus = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('ok'),
    branch: z.string().nullable(),
    detachedAt: z.string().nullable(),
    operation: z.enum(['merge', 'rebase', 'cherry-pick', 'revert', 'bisect']).nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nullable(),
    behind: z.number().int().nullable(),
    lastFetchAt: z.number().nullable(),
    changes: z.object({ total, staged, unstaged, untracked, conflicted: z.number().int(), truncated: z.boolean() }),
    files: z.array(GitFile).max(500),
    lastCommit: z.object({ hash: z.string(), subject: z.string(), author: z.string(), at: z.number() }).nullable(),
  }),
  z.object({ state: z.literal('git-missing') }),
  z.object({ state: z.literal('not-a-repo') }),
  z.object({ state: z.literal('failed') }),
]);
// methods: status({}) → GitStatus; openFile({ path }) → void. events: changed (undefined).
```

## Testing

- **Unit (every OS):**
  - `parseStatus` with fixtures: clean, branch with upstream ahead and behind, no upstream, detached, initial (no commits), a rename with an original path, unmerged files, paths with spaces and unicode, and truncated output;
  - `parseCommit` with fixtures: plain, signed (`gpgsig` block), multi-line message and an author name with unicode;
  - `resolveGitDirs`: a plain `.git` folder, a worktree `.git` file with `commondir`, and a broken pointer;
  - operation detection;
  - `openFile` path validation;
  - the watcher: `.lock` names ignored, coalescing, restart on a path change and stop on `forgetProject`;
  - the tool handler with a fake platform (exit 128, git missing, timeout).
- **Integration (Windows and macOS CI, skipped elsewhere like the other integration files):** a temporary repo built with the real `git`. It has a commit, a staged file, a modified file and an untracked file named with a space. `status` returns the expected counts and the last commit, and a new commit fires `changed`.
- **Renderer:** the card for each state (ok/clean, ok/changes, detached plus rebasing, git-missing, not-a-repo, failed with Retry), the panel groups and the Open button, and a window `focus` that refetches.
- **End-to-end:** a fixture project that the spec turns into a git repo at runtime (`git init`, commit, modify a file). The overview shows the Git card with the branch and "1 change". It runs on both CI OSes.
