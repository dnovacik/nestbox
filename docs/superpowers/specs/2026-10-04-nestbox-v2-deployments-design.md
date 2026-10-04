# NestBox v2 (Deployments): Design Notes

Date: 2026-10-04
Status: Approved 2026-10-04. The owner picked three deployment tools (this one, "Env vs production" and "Ready to deploy") and chose the big four platforms first, one-click preview with a confirmed production deploy, and no rollback. The command details below were checked against Vercel CLI 62.2, Netlify CLI 27.10, Wrangler 4.147 and flyctl's source (`internal/command/apps/releases.go`).

## Scope

A **Deploy** tab and card for packages that deploy to Vercel, Netlify, Cloudflare (Workers or Pages) or Fly.io:
- recent deployments with state, environment, branch, age and URL;
- open the deployment, its logs and the platform's dashboard;
- deploy a preview with one click, its output streamed into a log;
- deploy to production after a confirmation dialog that names the package and the platform.

Ships as **v1.14.0** from `v2-deployments`, stacked on `v2-light-theme`.

**Not in this release:**
- Rollback, promote, aliases and domains: they stay in the platform's dashboard.
- Render and Railway (next).
- Netlify's deploy list (see decision 4).
- Env comparison and pre-deploy checks: the next two releases.

## Principle

NestBox reaches a platform only through its official CLI, which the user installed and logged in to. It stores no token, account or team; the CLI's own login is the only credential. It goes to the network only when the user acts: opening the Deploy tab or pressing Refresh lists deployments, and the Deploy buttons deploy. The card shows local facts only.

## Decisions

| # | Gap | Decision |
| --- | --- | --- |
| 1 | Detection | `DetectedProject.deploy: ('vercel' \| 'netlify' \| 'cloudflare' \| 'fly')[]`, from file names in the package folder: `vercel.json` or a `.vercel` folder; `netlify.toml` or a `.netlify` folder; `wrangler.toml`, `wrangler.json` or `wrangler.jsonc`; `fly.toml`. The tool applies when the list isn't empty. A package can have several. |
| 2 | Local status | `status` reads small files only (64 KiB cap) and never runs a network command. **Vercel** is linked when `.vercel/project.json` has a `projectId` (`projectName` is shown when present). **Netlify** is linked when `.netlify/state.json` (package, then root) has a `siteId`. **Cloudflare:** the config's top-level `name`; Pages when `pages_build_output_dir` is set, Workers otherwise. **Fly:** `app` from `fly.toml`. The TOML reading is a top-level `key = "value"` match before the first `[table]`; JSONC strips comments and trailing commas first. Missing name = not linked. |
| 3 | CLI | The project's own CLI when its package resolves from the package folder upwards (`vercel`, `netlify-cli`, `wrangler`), run through the package manager like Prisma (`pnpm exec`, `yarn`, `npx --no-install`, `bunx --no-install`); otherwise the global `vercel`, `netlify`, `wrangler`, or `flyctl` (then `fly`) from `commandExists`. None = "CLI not installed", with the install command to copy. Commands run through `spawnCommand` in the package folder with the login-shell env, `NO_COLOR=1`, stdin closed (a prompt fails instead of hanging). |
| 4 | Listing | **Vercel:** `vercel list --format json --limit 10 --non-interactive`, only when linked (unlinked, it lists the whole team). Keeps `id`, `url`, `state`, `target`, `createdAt` and the `meta.*CommitRef` branch, plus `contextName` for the dashboard link. **Cloudflare Workers:** `wrangler deployments list --json`: `id`, `created_on`, `source`, the version percentages. **Pages:** `wrangler pages deployment list --project-name <name> --json`: `Id`, `Environment`, `Branch`, `Source` (short SHA), `Deployment` (URL), `Status` and `Build` (dashboard). **Fly:** `flyctl releases --json`: `Version`, `Status`, `CreatedAt`. **Netlify** lists deploys only through `netlify api listSiteDeploys --data '<json>'`, and a JSON argument can't pass through cmd.exe safely on Windows (`assertCmdSafe` refuses `"`). Netlify shows the linked site from `netlify status --json` (name, URL, admin URL) and a "Deploy history" link to the admin page. At most 10 rows per platform; results live in memory only. |
| 5 | States | Every platform maps onto `ready`, `building`, `queued`, `error`, `canceled` or `unknown`. Environment is `production`, `preview` or null. URLs reach the renderer only when they parse as `https:`. Unknown output is a failed listing, never an empty one. |
| 6 | Errors | stderr is classified, never shown or logged: `logged-out` (each CLI's "not logged in" wording), `not-linked`, or `failed`, plus `timeout` (30 s for a listing). Logged out offers **Log in**, which opens a terminal with `vercel login`, `netlify login`, `wrangler login` or `flyctl auth login`. Not linked offers **Link** in a terminal (`vercel link`, `netlify link`). |
| 7 | Deploy | **Preview:** `vercel deploy --non-interactive`; `netlify deploy`; Workers `wrangler versions upload` (a version with a preview URL, not deployed); Pages `wrangler pages deploy --branch nestbox-preview`. Fly has no preview. **Production:** `vercel deploy --prod --non-interactive`; `netlify deploy --prod`; `wrangler deploy`; Pages `wrangler pages deploy --branch <production branch>`, where the branch is the one of the newest Production deployment in the last listing (unknown = no production button, with a hint); `flyctl deploy`. The contract takes `{ platform, target }` and production needs `confirmed: true`; the renderer's dialog names the package and the platform. One deploy per package at a time (CONFLICT), 20-minute timeout, **Cancel** kills the tree. The output goes to the Deploy log; the last platform URL in it (`*.vercel.app`, `*.netlify.app`, `*.workers.dev`, `*.pages.dev`, `*.fly.dev`) becomes "Open". The listing refreshes after a deploy. |
| 8 | Arguments | Only NestBox tokens reach a command line, plus the Pages project name (`^[a-z0-9][a-z0-9-]{0,57}$`) and branch (letters, digits, `._/-`, no leading `-`, at most 100). Everything else (Fly app, Worker name) is read by the CLI from its own config. |
| 9 | Dashboard | Vercel `https://vercel.com/<context>/<project>` once a listing gave the context, and a deployment's inspector under it. Netlify the status's admin URL. Cloudflare `https://dash.cloudflare.com/?to=/:account/workers/services/view/<name>` or `/pages/view/<name>`, and a Pages deployment's `Build` link. Fly `https://fly.io/apps/<app>` and `/monitoring` for logs. All open through `app:openExternal`. |
| 10 | Privacy | Deploy output is shown and never stored or logged (like script output). Logs carry the platform, the target, step codes, exit codes and times; never names, URLs or output. Vercel's `meta` keeps only the branch: commit messages and authors are dropped, and so is Workers' `author_email`. |
| 11 | UI | **Card:** each platform with its linked name, or "not linked" or "CLI missing", plus the state of a deploy running now. **Tab:** a section per platform with the dashboard link, Refresh, **Deploy preview**, **Deploy to production…**, and the deployments table (state badge, environment, branch, age, Open and Logs). The Deploy log sits below with Cancel while a deploy runs. |
| 12 | Version | 1.14.0. |

## Testing

- **Unit tests:**
  - local status from config files (TOML, JSONC, linked or not);
  - CLI resolution (local package through the manager, global, missing);
  - parsers fed the shapes the CLIs print (fixtures);
  - stderr classification;
  - production refused without `confirmed`;
  - the CONFLICT lock, Cancel, timeout, the URL picked from the output;
  - logs without names or URLs.
- **Renderer tests:** card states, the tab (listing, confirm dialog naming the package and platform, log), the hook.
- **End-to-end:** a fake `vercel` on PATH (`e2e/fixtures/fake-vercel`) answers `list` and `deploy`. Opening the tab lists deployments; Deploy preview streams output and shows the URL; production asks first.
