// Parsers for the package managers' own outdated and audit output. Every one returns null when the output
// isn't what the command prints on success, so a network error or a changed format is a failed step, never
// a silently empty result. Exit codes are not looked at: npm and pnpm exit 1 when they find something.
import { type Advisory, SEVERITIES, type Severity } from '@shared/tools/deps/contract';

export interface Outdated {
  name: string;
  current: string | null;
  wanted: string | null;
  latest: string | null;
}

/** Advisories per package name. */
export type Vulns = Map<string, Advisory[]>;

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

/** JSON lines; undefined when any non-empty line isn't JSON. */
function jsonLines(text: string): unknown[] | undefined {
  const out: unknown[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const value = json(line);
    if (value === undefined) return undefined;
    out.push(value);
  }
  return out;
}

function severity(value: unknown): Severity {
  const s = typeof value === 'string' ? value.toLowerCase() : '';
  if (s === 'medium') return 'moderate';
  return (SEVERITIES as readonly string[]).includes(s) ? (s as Severity) : 'info';
}

function advisory(fields: {
  id: unknown;
  ghsa?: unknown;
  title: unknown;
  severity: unknown;
  url: unknown;
  range: unknown;
}): Advisory {
  const url = str(fields.url);
  const ghsa = str(fields.ghsa) ?? (url ? (/GHSA-[\w-]+/.exec(url)?.[0] ?? null) : null);
  return {
    id: ghsa ?? String(fields.id ?? '?'),
    title: str(fields.title) ?? 'Advisory',
    severity: severity(fields.severity),
    // Only https links open (app:openExternal also checks); anything else is dropped here.
    url: url?.startsWith('https://') ? url : null,
    range: str(fields.range),
  };
}

function add(vulns: Vulns, name: unknown, a: Advisory): void {
  if (typeof name !== 'string' || name === '') return;
  const list = vulns.get(name) ?? [];
  if (!list.some((x) => x.id === a.id)) list.push(a);
  vulns.set(name, list);
}

function outdatedMap(value: unknown): Outdated[] | null {
  if (!isObj(value)) return null;
  const out: Outdated[] = [];
  for (const [name, raw] of Object.entries(value)) {
    const entry = Array.isArray(raw) ? raw[0] : raw;
    if (!isObj(entry)) continue;
    out.push({
      name,
      current: str(entry['current']),
      wanted: str(entry['wanted']),
      latest: str(entry['latest']),
    });
  }
  return out;
}

/** `npm outdated --json`: { name: { current, wanted, latest } } (an array per name across workspaces). */
export function parseNpmOutdated(text: string): Outdated[] | null {
  return text.trim() === '' ? [] : outdatedMap(json(text));
}

/** `pnpm outdated --format json`: the same map as npm's. */
export const parsePnpmOutdated = parseNpmOutdated;

/** `yarn outdated --json` (Yarn 1): JSON lines, one `table` with [Package, Current, Wanted, Latest, …] rows. */
export function parseYarn1Outdated(text: string): Outdated[] | null {
  const lines = jsonLines(text);
  if (!lines) return null;
  const out: Outdated[] = [];
  for (const line of lines) {
    if (!isObj(line) || line['type'] !== 'table' || !isObj(line['data'])) continue;
    const body = line['data']['body'];
    if (!Array.isArray(body)) return null;
    for (const row of body) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      out.push({ name: row[0], current: str(row[1]), wanted: str(row[2]), latest: str(row[3]) });
    }
  }
  return out;
}

/** `npm audit --json`: vulnerabilities whose `via` holds advisory objects (string entries are dependents). */
export function parseNpmAudit(text: string): Vulns | null {
  const value = json(text);
  if (!isObj(value) || !isObj(value['vulnerabilities'])) return null;
  const vulns: Vulns = new Map();
  for (const [name, entry] of Object.entries(value['vulnerabilities'])) {
    if (!isObj(entry) || !Array.isArray(entry['via'])) continue;
    for (const via of entry['via']) {
      if (!isObj(via)) continue;
      add(
        vulns,
        name,
        advisory({
          id: via['source'],
          title: via['title'],
          severity: via['severity'],
          url: via['url'],
          range: via['range'],
        }),
      );
    }
  }
  return vulns;
}

const fromAdvisoryObject = (a: Obj) =>
  advisory({
    id: a['id'],
    ghsa: a['github_advisory_id'],
    title: a['title'],
    severity: a['severity'],
    url: a['url'],
    range: a['vulnerable_versions'],
  });

/** `pnpm audit --json`: { advisories: { id: { module_name, severity, title, url, vulnerable_versions } } }. */
export function parsePnpmAudit(text: string): Vulns | null {
  const value = json(text);
  if (!isObj(value) || !isObj(value['advisories'])) return null;
  const vulns: Vulns = new Map();
  for (const a of Object.values(value['advisories']))
    if (isObj(a)) add(vulns, a['module_name'], fromAdvisoryObject(a));
  return vulns;
}

/** `yarn audit --json` (Yarn 1): JSON lines; `auditAdvisory` lines carry the same advisory object as pnpm. */
export function parseYarn1Audit(text: string): Vulns | null {
  const lines = jsonLines(text);
  if (!lines) return null;
  const vulns: Vulns = new Map();
  let summary = false;
  for (const line of lines) {
    if (!isObj(line)) continue;
    if (line['type'] === 'auditSummary') summary = true;
    const data = line['data'];
    if (line['type'] === 'auditAdvisory' && isObj(data) && isObj(data['advisory'])) {
      add(vulns, data['advisory']['module_name'], fromAdvisoryObject(data['advisory']));
    }
  }
  // A successful audit always ends with a summary; without one the registry wasn't reached.
  return summary || vulns.size > 0 ? vulns : null;
}

/** `yarn npm audit --json` (Yarn 2+): JSON lines `{ value: name, children: { ID, Issue, URL, Severity, … } }`. */
export function parseBerryAudit(text: string): Vulns | null {
  const lines = jsonLines(text);
  if (!lines) return null;
  const vulns: Vulns = new Map();
  for (const line of lines) {
    if (!isObj(line) || !isObj(line['children'])) continue;
    const c = line['children'];
    add(
      vulns,
      line['value'],
      advisory({
        id: c['ID'],
        title: c['Issue'],
        severity: c['Severity'],
        url: c['URL'],
        range: c['Vulnerable Versions'],
      }),
    );
  }
  return vulns;
}

/** `bun audit --json`: { name: [{ id, url, title, severity, vulnerable_versions }] }. */
export function parseBunAudit(text: string): Vulns | null {
  const value = json(text);
  if (!isObj(value)) return null;
  const vulns: Vulns = new Map();
  for (const [name, list] of Object.entries(value)) {
    if (!Array.isArray(list)) return null;
    for (const a of list) if (isObj(a)) add(vulns, name, fromAdvisoryObject(a));
  }
  return vulns;
}
