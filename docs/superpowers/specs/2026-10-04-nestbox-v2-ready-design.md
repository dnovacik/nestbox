# NestBox v2 (Ready to deploy): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04 as the third deployment tool. The owner chose "run on click": **Run checks** runs the scripts the user picks (build, test, lint and typecheck preselected when present) plus instant checks, ending in a green, amber or red summary.

## Scope

A **Ready to deploy** section at the top of the Deploy tab. Ships as **v1.16.0** from `v2-ready`, stacked on `v2-env-compare`.

**Not in this release:**
- running the checks before every deploy, or blocking a deploy;
- custom checks;
- running scripts in parallel.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Checks | In this order, each `ok`, `warn`, `fail` or `skip`: **Node** (the Node tool's status), **Dependencies** (the Dependencies tool's last results), **Env** (Env vs production for the first platform that is ready, its first environment, the default env file), **Git** (the Git tool's status), then each picked **script**. The result shows checks as they finish (`pending`, then `running`, then the result) through the tool's `changed` event. |
| 2 | Node | Platforms build with the version the project declares (`.nvmrc`, `engines.node`, …), so the check compares that with the local Node. **fail:** local Node doesn't satisfy the requirement. **warn:** no requirement ("the platform uses its default") or it can't be resolved offline. **ok:** they match. |
| 3 | Dependencies | **warn:** high or critical advisories in the last check, or never checked. **ok:** none. It never runs a new check: that stays on Check and the schedule. |
| 4 | Env | **fail:** keys in the local file are missing on the platform (named in the detail: key names only). **warn:** the comparison couldn't run (logged out, timeout…). **skip:** no ready platform or no env file. |
| 5 | Git | **warn:** uncommitted changes, commits not pushed, or no upstream. **ok:** clean and pushed. **skip:** not a repository or git missing. It never fetches. |
| 6 | Scripts | Run one at a time through the Scripts tool (ProcessManager, so the Node advice and the script's own log apply; the log is in the Scripts tab). Each waits for the exit: code 0 = **ok**, anything else = **fail** with the code; already running = **fail** ("already running"). 15 minutes each, then it is stopped (**fail**, timed out). Names must be scripts in the package's `package.json`; at most 10. Preselected: `build`, `test`, `lint`, `typecheck` when present. |
| 7 | Summary | **Red** if any check fails, **amber** if any warns, **green** otherwise. It lives in memory per package with its time; one run at a time per package (CONFLICT). |
| 8 | Wiring | The Deploy tool gets `tools.invoke` (the tool host, late-bound like the scripts tool's) and `runScript` (start through the Scripts tool, wait on ProcessManager's events). Each tool result is parsed with that tool's schema; a failure becomes `skip` with a reason. |
| 9 | Privacy | Logs carry check kinds, tones and times. Key names show in the Env detail (as in Env vs production); nothing is stored. |
| 10 | Version | 1.16.0. |

## Testing

- **Unit tests:**
  - each check's evaluation from fixtures of the other tools' results;
  - the overall tone;
  - `waitForScript` (exit 0, crash, already running, timeout, an exit that comes before the subscription);
  - the tool's run (order, progress events, CONFLICT, script validation).
- **Renderer:** the section (script picks preselected, Run checks, tones and the summary).
- **End-to-end:** the deploy fixture gets a `build` script and a `.env.production`; Run checks shows the build passing and the Env check failing (red).
