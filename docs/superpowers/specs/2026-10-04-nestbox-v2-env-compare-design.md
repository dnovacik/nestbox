# NestBox v2 (Env vs production): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04 as the second of the three deployment tools. The owner chose "pick per comparison": a selector of the platform's environments with production preselected, key names only. The commands were checked against Vercel CLI 62.2, Netlify CLI 27.10, Wrangler 4.147 and flyctl's source (`internal/command/secrets/list.go`).

## Scope

Compare the keys of a local env file with the variables a platform has for one environment, and show:
- keys missing on the platform;
- keys only on the platform;
- how many are in both.

It lives in the Deploy tab, one "Env" row per platform, because it shares the Deploy tool's CLI resolution, login handling and detection. Ships as **v1.15.0** from `v2-env-compare`, stacked on `v2-deployments`.

**Not in this release:** setting or copying variables to the platform, comparing values, Render and Railway.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Environments | Local facts in `PlatformStatus.environments`, first = preselected. **Vercel:** `production`, `preview`, `development`. **Netlify:** `production`, `deploy-preview`, `branch-deploy`, `dev`. **Cloudflare Workers:** `production` (the top level) plus the named `[env.<name>]` environments of the wrangler config. **Cloudflare Pages:** `production`, `preview`. **Fly:** `app` (one set of secrets). Names reaching a command line match `^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$` and must be in the list. |
| 2 | Platform keys | **Vercel:** `env ls <environment> --format json --non-interactive` (`envs[].key`). **Netlify:** `env:list --json --context <context>` (the object's keys). **Workers:** `secret list --format json` (`[].name`, with `--env <name>` for a named environment) plus the `vars` keys in the wrangler config for that environment. **Pages:** `pages secret list --project-name <name> --env <production\|preview>` (text lines `- NAME: Value Encrypted`) plus the config's `vars` keys. **Fly:** `secrets list --json` (`[].name`) plus `fly.toml`'s `[env]` keys. Vercel and Netlify print values in that JSON: the parser keeps only the keys, and the output is dropped at once (never stored, logged or sent to the renderer). |
| 3 | Local keys | One env file from the package folder, picked in a second selector. The default is the first of `.env.production`, `.env.production.local` and `.env` that exists. It's read through the env tool's file access (1 MiB cap) and parsed with `dotenv.ts`; only the key names are kept. |
| 4 | Result | `{ state: 'ok', onlyLocal, onlyRemote, both }` (sorted key names) or a failure state shared with listings (`cli-missing`, `not-linked`, `logged-out`, `failed`, `timeout`), plus `no-file`. |
| 5 | When | Only on **Compare** (network). Nothing is cached in main; the renderer keeps the last result while the tab is open. |
| 6 | Privacy | Key names only, in both directions. Logs carry the platform, counts, exit codes and times. |
| 7 | Version | 1.15.0. |

## Testing

- **Unit tests:**
  - environment lists from local config (named Workers environments);
  - each parser with fixtures, checking that values never come out;
  - TOML table keys and JSONC `vars`;
  - local file default and keys-only reading;
  - the tool's compare (sets, failures, validation of environment and file);
  - no values in logs.
- **Renderer:** the Env row (selectors, Compare, the three groups).
- **End-to-end:** the fake Vercel answers `env ls`; Compare shows a key missing on Vercel.
