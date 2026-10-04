// Parsers for the platforms' CLI output. Each keeps only what the tab shows (ids, states, environments,
// branches, times, https URLs): commit messages, authors and emails are dropped here. Output that isn't
// what the command prints on success is null, so a changed format is a failed listing, never an empty one.
import type { DeployPlatform } from '@shared/detected';
import type { Deployment, DeployState, Listing } from '@shared/tools/deploy/contract';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The JSON value in output that may have a banner line before it. */
function jsonIn(text: string): unknown {
  const whole = json(text.trim());
  if (whole !== undefined) return whole;
  const start = text.search(/^[[{]/m);
  return start === -1 ? undefined : json(text.slice(start).trim());
}

export function httpsUrl(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  try {
    return new URL(s).protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}

function time(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = str(value);
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** A branch that may reach a command line (Pages production deploys). */
export const BRANCH = /^[A-Za-z0-9._/][A-Za-z0-9._/-]{0,99}$/;

const VERCEL_STATES: Record<string, DeployState> = {
  READY: 'ready',
  BUILDING: 'building',
  INITIALIZING: 'building',
  QUEUED: 'queued',
  ERROR: 'error',
  CANCELED: 'canceled',
};

/** `vercel list --format json`: `{ contextName, deployments: [{ id, url, name, state, target, createdAt, meta }] }`. */
export function parseVercelList(
  text: string,
): { context: string | null; project: string | null; deployments: Deployment[] } | null {
  const value = jsonIn(text);
  if (!isObj(value) || !Array.isArray(value['deployments'])) return null;
  const context = str(value['contextName']);
  let project: string | null = null;
  const deployments: Deployment[] = [];
  for (const d of value['deployments']) {
    if (!isObj(d)) continue;
    const id = str(d['id']);
    if (id === null) continue;
    const name = str(d['name']);
    project ??= name;
    const meta = isObj(d['meta']) ? d['meta'] : {};
    const host = str(d['url']);
    deployments.push({
      id,
      state: VERCEL_STATES[String(d['state']).toUpperCase()] ?? 'unknown',
      environment: d['target'] === 'production' ? 'production' : 'preview',
      branch: str(meta['githubCommitRef']) ?? str(meta['gitlabCommitRef']) ?? str(meta['bitbucketCommitRef']),
      label: null,
      createdAt: time(d['createdAt']),
      url: host ? httpsUrl(`https://${host}`) : null,
      logsUrl:
        context && name
          ? httpsUrl(`https://vercel.com/${encodeURIComponent(context)}/${encodeURIComponent(name)}/${id.replace(/^dpl_/, '')}`)
          : null,
    });
  }
  return { context, project, deployments };
}

/** `wrangler deployments list --json`: oldest first; each with `created_on` and its version split. */
export function parseWorkersList(text: string, dashboardUrl: string | null): Deployment[] | null {
  const value = jsonIn(text);
  if (!Array.isArray(value)) return null;
  const out: Deployment[] = [];
  for (const d of value) {
    if (!isObj(d) || str(d['id']) === null) continue;
    const versions = Array.isArray(d['versions']) ? d['versions'].filter(isObj) : [];
    const label = versions
      .map((v) => `${String(v['version_id'] ?? '').slice(0, 8)} ${typeof v['percentage'] === 'number' ? v['percentage'] : '?'}%`)
      .join(' · ');
    out.push({
      id: str(d['id']) as string,
      state: 'ready',
      environment: 'production',
      branch: null,
      label: label || null,
      createdAt: time(d['created_on']),
      url: null,
      logsUrl: dashboardUrl,
    });
  }
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

const PAGES_STATES: Record<string, DeployState> = {
  active: 'building',
  queued: 'queued',
  idle: 'queued',
  failure: 'error',
  canceled: 'canceled',
  skipped: 'canceled',
  success: 'ready',
};

/** `wrangler pages deployment list --json`: newest first; `Status` is a stage word, or the finish time once it succeeded. */
export function parsePagesList(text: string): Deployment[] | null {
  const value = jsonIn(text);
  if (!Array.isArray(value)) return null;
  const out: Deployment[] = [];
  for (const d of value) {
    if (!isObj(d) || str(d['Id']) === null) continue;
    const env = String(d['Environment'] ?? '').toLowerCase();
    out.push({
      id: str(d['Id']) as string,
      state: PAGES_STATES[String(d['Status'] ?? '').toLowerCase()] ?? (str(d['Status']) ? 'ready' : 'unknown'),
      environment: env === 'production' ? 'production' : env === 'preview' ? 'preview' : null,
      branch: str(d['Branch']),
      label: str(d['Source']),
      createdAt: null,
      url: httpsUrl(d['Deployment']),
      logsUrl: httpsUrl(d['Build']),
    });
  }
  return out;
}

/** The branch of the newest production deployment, when it can go on a command line. */
export function productionBranch(deployments: readonly Deployment[]): string | null {
  const branch = deployments.find((d) => d.environment === 'production')?.branch ?? null;
  return branch !== null && BRANCH.test(branch) ? branch : null;
}

const FLY_STATES: Record<string, DeployState> = {
  complete: 'ready',
  completed: 'ready',
  succeeded: 'ready',
  successful: 'ready',
  running: 'building',
  pending: 'queued',
  failed: 'error',
  interrupted: 'error',
  cancelled: 'canceled',
  canceled: 'canceled',
};

/** `flyctl releases --json`: `[{ Version, Status, CreatedAt, … }]`, newest first. */
export function parseFlyReleases(text: string, logsUrl: string | null): Deployment[] | null {
  const value = jsonIn(text);
  if (!Array.isArray(value)) return null;
  const out: Deployment[] = [];
  for (const r of value) {
    if (!isObj(r) || typeof r['Version'] !== 'number') continue;
    out.push({
      id: str(r['ID']) ?? `v${r['Version']}`,
      state: FLY_STATES[String(r['Status'] ?? '').toLowerCase()] ?? 'unknown',
      environment: 'production',
      branch: null,
      label: `v${r['Version']}`,
      createdAt: time(r['CreatedAt']),
      url: null,
      logsUrl,
    });
  }
  return out;
}

/** `netlify status --json`: the linked site, or its error code. */
export function parseNetlifyStatus(text: string): Listing | null {
  const value = jsonIn(text);
  if (!isObj(value)) return null;
  const error = isObj(value['error']) ? value['error']['code'] : null;
  if (value['loggedIn'] === false || error === 'NOT_LOGGED_IN') return { state: 'logged-out' };
  if (value['linked'] === false || error === 'NOT_LINKED') return { state: 'not-linked' };
  const site = value['siteData'];
  if (!isObj(site)) return null;
  return {
    state: 'site',
    name: str(site['site-name']),
    url: httpsUrl(site['site-url']),
    adminUrl: httpsUrl(site['admin-url']),
  };
}

const LOGGED_OUT: Record<DeployPlatform, RegExp> = {
  vercel: /no existing credentials|token is not valid|not logged in|vercel login/i,
  netlify: /not logged in|NOT_LOGGED_IN|netlify login|session has expired/i,
  cloudflare: /not logged in|not authenticated|wrangler login|CLOUDFLARE_API_TOKEN/i,
  fly: /no access token|not logged in|auth login|unauthorized/i,
};

const NOT_LINKED: Partial<Record<DeployPlatform, RegExp>> = {
  vercel: /isn't linked|not linked|vercel link/i,
  netlify: /NOT_LINKED|netlify link|not appear to be in a folder that is linked/i,
};

/** Only classifies: the CLI's text is never shown or logged. */
export function classifyFailure(platform: DeployPlatform, output: string): 'logged-out' | 'not-linked' | 'failed' {
  if (LOGGED_OUT[platform].test(output)) return 'logged-out';
  if (NOT_LINKED[platform]?.test(output)) return 'not-linked';
  return 'failed';
}

const URL_HOSTS: Record<DeployPlatform, RegExp> = {
  vercel: /\.vercel\.app$/,
  netlify: /\.netlify\.app$/,
  cloudflare: /\.(workers|pages)\.dev$/,
  fly: /\.fly\.dev$/,
};

/** The last URL on the platform's own domains in a deploy's output: what "Open" opens. */
export function deployUrl(platform: DeployPlatform, output: string): string | null {
  let found: string | null = null;
  for (const m of output.matchAll(/https:\/\/[^\s"'<>`[\]]+/g)) {
    const candidate = m[0].replace(/[),.;]+$/, '');
    try {
      if (URL_HOSTS[platform].test(new URL(candidate).hostname)) found = candidate;
    } catch {
      // not a URL
    }
  }
  return found;
}
