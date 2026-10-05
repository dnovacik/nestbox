# NestBox v2: CI status tool (1.19.0)

The owner's answers (2026-10-04):

- GitHub Actions and GitLab CI.
- Show failed jobs and a tail of their log.
- Open in the browser, Refresh, and follow a running pipeline.
- Re-run failed jobs, plus a CI check in Ready to deploy.

## Shape

A tool `ci` ("CI", lucide `workflow`) on folders with their own `.git` (`p.git !== null`, like Git). CI belongs to a repository, so a workspace package doesn't get it. NestBox keeps no token: the provider's CLI (`gh`, `glab`) and its login are the credential, as with the Deploy tool.

**Provider.** `remote.ts` reads `<commondir>/config` and takes `origin`'s URL, else the first remote's. Only the host is kept, never the URL, which can carry a user or token:

- `github.com` or `*.ghe.com` → GitHub;
- a host containing `gitlab` → GitLab;
- otherwise `.github/workflows/` → GitHub, `.gitlab-ci.yml` → GitLab;
- otherwise null, and the tab explains what it needs.

**Branch.** The current branch is read live with `readGitInfo`, not from detection. A branch name reaches the command line only when it matches `^[A-Za-z0-9._/-]{1,200}$`; otherwise the listing isn't filtered and the tab says so.

## Commands

All of them run through `spawnCommand` in the project folder (shell env, `NO_COLOR`, stdin closed, 30 s, stdout capped at 4 MiB). stderr is only classified (logged-out / no-remote / failed) and never shown or logged. Run and job ids must be digits.

| | GitHub (`gh`) | GitLab (`glab`) |
| --- | --- | --- |
| Runs | `run list --branch <b> --limit 15 --json databaseId,status,conclusion,workflowName,displayTitle,headBranch,headSha,event,createdAt,updatedAt,url` | `ci list --per-page 30 --output json`, filtered by `ref` in main (15 kept) |
| Jobs | `run view <id> --json jobs` | `ci get --pipeline-id <id> --output json` (`jobs`) |
| Log tail | `run view --job <jobId> --log-failed` (tab-separated `job, step, line`; the first two columns are dropped) | `ci trace <jobId>`, finished jobs only |
| Re-run failed | `run rerun <id> --failed` | `ci retry <jobId>` for each failed job that isn't allowed to fail (at most 20) |
| Log in | `gh auth login` in a terminal | `glab auth login` in a terminal |

**States.** Both providers map to `queued | running | success | failure | canceled | skipped | manual | unknown`:

- GitHub: `in_progress` → running; any other incomplete status → queued. `failure`, `timed_out` and `startup_failure` → failure; `cancelled` → canceled; `skipped` and `neutral` → skipped; `action_required` → manual.
- GitLab: `created`, `waiting_for_resource`, `preparing`, `pending` and `scheduled` → queued; `failed` → failure.

**What leaves main.** `parse.ts` keeps ids, states, workflow, branch, the short SHA, event, times, https URLs and the run title (the commit or PR title, shown like the Git tool shows subjects). It also keeps job names, stages and the failed step.

**Log tail.** At most the last 200 lines, ANSI codes and GitLab `section_start`/`section_end` markers stripped. It is returned to the panel only: never stored or logged. Logs carry ids, provider, states, counts and codes; never branches, titles, names or URLs.

## Contract

- `status` (local only): `{ provider, cli: found|missing, install, branch, latest }`. `latest` is the newest run of the current branch that this session has seen, from the last listing. The overview card shows it without touching the network.
- `runs` `{ scope: 'branch' | 'all' }` → `{ state: 'ok', branch, filtered, runs } | { state: 'cli-missing' | 'logged-out' | 'no-remote' | 'no-provider' | 'failed' | 'timeout' }`.
- `jobs` `{ runId }` → `{ state: 'ok', jobs } | failure`.
- `jobLog` `{ runId, jobId }` → `{ state: 'ok', lines, truncated } | failure`.
- `rerunFailed` `{ runId }` → `{ ok, retried }`. One action per project at a time (CONFLICT).
- `latest` → the current branch's newest run, or null (Ready to deploy).
- `login`: opens a terminal.
- Event `changed`: `latest` changed.

## Renderer

**Panel.**
- Header: provider, branch, a "This branch / All branches" switch, Refresh.
- Runs list: state dot, title, workflow, branch, time ago, Open.
- Selected run: its jobs. A failed job shows its failed step and a "Show log" button, which loads the tail into a monospace block.
- "Re-run failed jobs" appears when the run failed.
- Follow: while the shown runs or the selected run are queued or running, refetch every 20 s, and only while the panel is mounted.
- Setup states: install the CLI (with Copy), log in (opens a terminal), no remote.

**Overview card.** The latest run of the current branch from `status`, or nothing until the tab has listed runs this session.

## Ready to deploy

A `ci` check runs after Git. It calls the tool host's `ci.latest` on the package's root:

- success → ok;
- failure → fail;
- queued or running → warn ("Still running");
- canceled and other states → warn;
- no run, no provider, no CLI, logged out, or the tool turned off → skip.

## Tests

- **Unit:** remote parsing, parsers (fixtures in the shapes gh 2.x and glab 1.x print), the tool (fake spawn), the ready check, the panel and card.
- **End to end:** `e2e/fixtures/fake-gh` (runs, jobs, log, rerun logged to `.fake-gh.log`) on a fixture repository with a GitHub origin. The test lists runs, opens a failed job's log, and re-runs failed jobs.
