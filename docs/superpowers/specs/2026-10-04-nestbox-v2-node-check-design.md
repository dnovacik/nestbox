# NestBox v2 (Node version check): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04. The tool and its scope come from the owner's write-up ("Next in v2: Node version check and dependency health"). The owner chose the order, the start behaviour, the fnm switch and the placement; the remaining defaults are for review with the PR.
Source of truth: `docs/nestbox-spec.md`, "v2 tools". Dependency health follows as its own release.

## Scope

The Node tab and card show three things:
- which Node version a package needs, and where that requirement comes from;
- whether the sources agree;
- whether the Node and package manager that will really run the scripts match the requirement.

Scripts started on a mismatch get a warning. With fnm, a per-project switch runs scripts on the required version. Ships as **v1.11.0** from `v2-node-check`, stacked on `v2-compose-groups`.

**Not in this release:**
- Installing Node versions.
- Switching nvm or nvm-windows.
- asdf, mise and n (they show as "no version manager found").
- Dependency health (next release).

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Sources | `.nvmrc`, `.node-version`, `engines.node` and `volta.node`, in that order. The first one found is the requirement. Files are read from the package folder, then the root, so a workspace package inherits the root's `.nvmrc`. `engines` and `volta` come from the package's `package.json`, then the root's. A file larger than 1 KiB, or a value that is no version or range, is reported as unreadable. |
| 2 | Versions | Parsed with `semver` (a new runtime dependency). `20`, `v20.11.1` and `20.11` become ranges; LTS codenames map to their major (`lts/iron` → 20). `lts/*`, `node` and `stable` can't be resolved without the network, so they are shown but not compared. |
| 3 | Conflicts | A source conflicts when its range doesn't intersect the requirement, which is the first source with a range: `engines` `>=20` against `.nvmrc` `18`. Each such source is marked as disagreeing with the requirement, which still comes from the first source. |
| 4 | Actual Node | `node --version`, run through `execCommand` with the package as `cwd` and the login-shell environment that scripts get. It is the Node the scripts will really use, Volta's per-folder shims included. |
| 5 | Package manager | `packageManager` (`pnpm@10.30.2+sha512…`) is parsed into a name and a version. The name is compared with the detected manager (lockfile), and the version exactly with `<pm> --version` run in the package. Corepack gets `COREPACK_ENABLE_NETWORK=0` and `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, so a check never downloads anything; when Corepack has no cached copy, the version is "unknown". `execCommand` takes optional extra env variables for this. |
| 6 | Version manager | fnm (on PATH), Volta (on PATH), nvm-windows (`nvm` on PATH on Windows) or nvm (`NVM_DIR` in the shell env, macOS). Only what is found is shown, together with what NestBox can do with it: fnm runs scripts on the required version, Volta switches on its own, and with nvm or nvm-windows NestBox only warns. |
| 7 | Status | `ok`, `mismatch` (the actual version is outside the requirement, or the package manager differs), `conflict` (sources disagree, versions otherwise fine), or `unknown` (no requirement, or Node not found). It is cached for 30 s per package; Refresh reruns it. |
| 8 | Start warning | Before a script starts, the scripts tool asks the Node tool for advice, through the tool host like Compose. On a mismatch the log's first line is `▲ Node 18.19.0 doesn't match >=20 (engines.node)` (or the package manager line), and the script row shows an amber "Node" badge with that text as its title. The script still starts, and run groups and the tray behave the same way. Advice that fails or takes over 3 s is skipped, so it never blocks a start. |
| 9 | fnm switch | The `node` tool setting `fnm: boolean` (root project, default off) is offered when fnm is found and the requirement can be resolved. While it is on, a start resolves `fnm exec --using=<version> node -p process.execPath` once per version (cached for the session) and puts that folder first on the script's `PATH`. Node and npm then come from the required version on both systems, without wrapping the command line. The version is the source text for version files and Volta, or the major of `engines`' lowest version (`>=20.11` → `20`). When fnm fails (for example, the version isn't installed), the log says so and the script starts with the normal PATH. With the switch on, the check reports the version fnm resolved. |
| 10 | Placement | An overview card shows the requirement and its source, the actual version and a status dot, and the package manager line when `packageManager` is set. The Node tab lists every source with its value and a conflict mark, the actual Node and package manager, the version manager, the fnm switch and Refresh. |
| 11 | Privacy | Versions and file names are not secret, but logs still carry only ids, statuses and codes. No network calls (Corepack offline, see D5). |
| 12 | Version | 1.11.0. |

## Testing

- **Unit tests:**
  - **Parsing:** each source, LTS codenames, unresolvable aliases, junk, oversize files, `packageManager` with a hash.
  - **Conflicts:** intersecting and disjoint ranges.
  - **Status:** ok, mismatch, conflict and unknown.
  - **Tool:** fake `execCommand` for node, pnpm and fnm; the Corepack env; the cache; the root fallback for workspaces; the fnm switch.
  - **Scripts:** the warning line and badge, the PATH prepend with fnm, and advice that fails or is slow.
- **Renderer tests:** the card, the tab (sources, conflict mark, version manager, switch), and the badge on a script row.
- **End-to-end:** a fixture with `.nvmrc` set to `1` (never the running Node): the card shows a mismatch, and starting the script shows the warning line and badge.
