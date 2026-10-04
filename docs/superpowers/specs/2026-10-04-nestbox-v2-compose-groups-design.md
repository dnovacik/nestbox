# NestBox v2 (Compose in run groups): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04. The owner chose this follow-up and asked to go on without approval stops; the decisions below are defaults for the owner to review with the PR.
Builds on the Compose design (`2026-10-04-nestbox-v2-compose-design.md`), which left "Run groups or scripts starting the stack" out of its release.

## Scope

A run group can include Docker Compose services. Starting the group brings those services up and waits until they are ready, then starts the group's scripts. So one click (the panel, the tray or the palette) starts db + api + web. Ships as **v1.10.0** from `v2-compose-groups`, stacked on the portfolio branch.

**Not in this release:**
- Ordering between scripts.
- Waiting for a script's port.
- `down` from a group.
- Compose profiles or extra `-f` files.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Data | `RunGroupSchema` gains `compose: { relPath, services: string[] }[]` (at most 20 packages, 50 services each; names follow `SERVICE_NAME`). An empty `services` list means the whole stack. Zod gives `compose` a default of `[]`, so stored groups load unchanged and the store stays at its version. A group needs at least one script or one compose entry. |
| 2 | Start order | Compose first: every package's services come up in parallel with `docker compose up -d --wait --wait-timeout 120 [services]`. `--wait` returns once containers are running, and healthy where they have a healthcheck, so a database is accepting connections before the API starts. Then the scripts start, as before. |
| 3 | Failure | A compose step that fails does not block the scripts. That covers Docker missing, the daemon being down, a non-zero exit (including a `--wait` timeout or a one-shot container that exits), an action already running (`busy`), and a package or file that's gone (`missing`). The group starts what it can, and the result lists each compose step as `ok` or with a reason. The renderer shows a warning toast naming the package and pointing to the Compose tab, where the output already is (the Actions log). |
| 4 | Services that left the file | Names are checked against the current `config --services`. Unknown names are dropped. If no named service is left, the step is `missing`. |
| 5 | Stop | Stopping the group stops its scripts and runs `docker compose stop [services]` for its compose entries: never `down`, so containers and volumes stay. Quitting NestBox still leaves containers alone (a quit is not a group stop). |
| 6 | Plumbing | The scripts tool gets a `compose` dependency (`up(projectId, services, { wait })`, `stop(projectId, services)`). `index.ts` wires it to the tool host's `compose` methods, so validation, the one-action-at-a-time rule and the Actions log stay in one place. The compose contract's `up`/`stop` accept `services` (a list) as well as `service`, and `up` accepts `wait`. |
| 7 | Editor | Under the scripts, the group dialog has a Compose section for each package with a compose file. "Start services" is a checkbox, then a choice: all services, or some of them (checkboxes from the Compose tool's status). When Docker can't list the services, only "All services" is offered, with a note. |
| 8 | List and palette | A group's line reads `api dev, web dev · compose: db, redis` (or `compose: all`). Stop is offered while a script of the group runs; a compose-only group shows both Start and Stop. The palette and tray need no change: they call `startRunGroup`. |
| 9 | Privacy | No change: service names are shown, and logs carry ids, the action and the exit code. |
| 10 | Version | 1.10.0. |

## Testing

- **Unit tests:**
  - **Schema:** the default `compose: []` for old groups; limits.
  - **Compose tool:** `up` with several services and `wait` builds `up -d --wait --wait-timeout 120 a b`; unknown names are dropped; nothing left means NOT_FOUND.
  - **Scripts tool:** compose runs before the scripts, and in parallel across packages; each failure becomes the right reason while the scripts still start; stop runs compose `stop` with the services; a group with only compose entries works.
- **Renderer tests:** the editor's compose section (all or some services, Docker unavailable); saving a compose-only group; the line summary; the toast for a failed compose step.
- **End-to-end:** the fake docker and a fixture with a compose file and a script. A group with `db` plus the script starts both (the Compose tab shows db running and the script runs). Stopping the group stops both.
