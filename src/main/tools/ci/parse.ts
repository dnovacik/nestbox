// Reads what gh and glab print. Only ids, states, names, branches, short SHAs, times, https URLs and run
// titles leave this file: users, emails, commit messages beyond the title and variables are dropped. Output
// that isn't the expected shape is null (a failed listing), never a guess.
import type { CiJob, CiRun, CiState } from '@shared/tools/ci/contract';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function id(v: unknown): string | null {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  if (typeof v === 'string' && /^[0-9]{1,20}$/.test(v)) return v;
  return null;
}

function time(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

function httpsUrl(v: unknown): string | null {
  const s = str(v);
  if (s === null) return null;
  try {
    return new URL(s).protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}

const shortSha = (v: unknown) => str(v)?.slice(0, 7) ?? null;

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout.replace(/^﻿/, ''));
  } catch {
    return undefined;
  }
}

export function ghState(status: unknown, conclusion: unknown): CiState {
  if (status === 'in_progress') return 'running';
  if (status !== 'completed') return 'queued';
  switch (conclusion) {
    case 'success':
      return 'success';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'failure';
    case 'cancelled':
      return 'canceled';
    case 'skipped':
    case 'neutral':
      return 'skipped';
    case 'action_required':
      return 'manual';
    default:
      return 'unknown';
  }
}

export function glabState(status: unknown): CiState {
  switch (status) {
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'pending':
    case 'scheduled':
      return 'queued';
    case 'running':
      return 'running';
    case 'success':
      return 'success';
    case 'failed':
      return 'failure';
    case 'canceled':
    case 'canceling':
      return 'canceled';
    case 'skipped':
      return 'skipped';
    case 'manual':
      return 'manual';
    default:
      return 'unknown';
  }
}

/** `gh run list --json databaseId,status,conclusion,workflowName,displayTitle,headBranch,headSha,event,createdAt,updatedAt,url` */
export function parseGhRuns(stdout: string): CiRun[] | null {
  const data = parseJson(stdout);
  if (!Array.isArray(data)) return null;
  const runs: CiRun[] = [];
  for (const r of data) {
    if (!isObj(r)) continue;
    const runId = id(r.databaseId);
    if (runId === null) continue;
    runs.push({
      id: runId,
      title: str(r.displayTitle),
      workflow: str(r.workflowName),
      branch: str(r.headBranch),
      sha: shortSha(r.headSha),
      event: str(r.event),
      state: ghState(r.status, r.conclusion),
      createdAt: time(r.createdAt),
      updatedAt: time(r.updatedAt),
      url: httpsUrl(r.url),
    });
  }
  return runs;
}

/** `gh run view <id> --json jobs` */
export function parseGhJobs(stdout: string): CiJob[] | null {
  const data = parseJson(stdout);
  if (!isObj(data) || !Array.isArray(data.jobs)) return null;
  const jobs: CiJob[] = [];
  for (const j of data.jobs) {
    if (!isObj(j)) continue;
    const jobId = id(j.databaseId);
    const name = str(j.name);
    if (jobId === null || name === null) continue;
    const state = ghState(j.status, j.conclusion);
    const steps = Array.isArray(j.steps) ? j.steps.filter(isObj) : [];
    const failed = state === 'failure' ? steps.find((s) => s.conclusion === 'failure') : undefined;
    jobs.push({
      id: jobId,
      name,
      stage: null,
      state,
      allowFailure: false,
      failedStep: failed ? str(failed.name) : null,
      startedAt: time(j.startedAt),
      finishedAt: time(j.completedAt),
      url: httpsUrl(j.url),
    });
  }
  return jobs;
}

/** `glab ci list --output json`: every branch; the tool filters by `ref`. */
export function parseGlabPipelines(stdout: string): CiRun[] | null {
  const data = parseJson(stdout);
  if (!Array.isArray(data)) return null;
  const runs: CiRun[] = [];
  for (const p of data) {
    if (!isObj(p)) continue;
    const runId = id(p.id);
    if (runId === null) continue;
    runs.push({
      id: runId,
      title: str(p.name),
      workflow: null,
      branch: str(p.ref),
      sha: shortSha(p.sha),
      event: str(p.source),
      state: glabState(p.status),
      createdAt: time(p.created_at),
      updatedAt: time(p.updated_at),
      url: httpsUrl(p.web_url),
    });
  }
  return runs;
}

/** `glab ci get --pipeline-id <id> --output json`: the pipeline with its `jobs`. */
export function parseGlabJobs(stdout: string): CiJob[] | null {
  const data = parseJson(stdout);
  if (!isObj(data) || !Array.isArray(data.jobs)) return null;
  const jobs: CiJob[] = [];
  for (const j of data.jobs) {
    if (!isObj(j)) continue;
    const jobId = id(j.id);
    const name = str(j.name);
    if (jobId === null || name === null) continue;
    jobs.push({
      id: jobId,
      name,
      stage: str(j.stage),
      state: glabState(j.status),
      allowFailure: j.allow_failure === true,
      failedStep: null,
      startedAt: time(j.started_at),
      finishedAt: time(j.finished_at),
      url: httpsUrl(j.web_url),
    });
  }
  // GitLab lists the newest first; the panel reads better in pipeline order.
  return jobs.sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
}

// CSI and OSC escape sequences (colours, hyperlinks), then the remaining control characters but tab.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

export function cleanLine(line: string): string {
  return line.replace(ANSI, '').replace(CONTROL, '');
}

function tail(lines: string[], max: number): { lines: string[]; truncated: boolean } {
  while (lines.length > 0 && lines.at(-1) === '') lines.pop();
  return lines.length > max
    ? { lines: lines.slice(-max), truncated: true }
    : { lines, truncated: false };
}

/** `gh run view --job <id> --log-failed`: `job<TAB>step<TAB><timestamp> <text>` per line. */
export function tailGhLog(stdout: string, max: number): { lines: string[]; truncated: boolean } {
  const lines = stdout.split(/\r?\n/).map((raw) => {
    const parts = raw.split('\t');
    const text = parts.length >= 3 ? parts.slice(2).join('\t') : raw;
    return cleanLine(
      text.replace(/^﻿/, '').replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ''),
    );
  });
  return tail(lines, max);
}

// A runner's collapsible sections: `section_start:<time>:<name>[<options>]\r\x1b[0K`.
const SECTION = /section_(?:start|end):\d+:[A-Za-z0-9_.-]+(?:\[[^\]]*\])?\r?(?:\x1b\[0K)?/g;

/** `glab ci trace <jobId>` of a finished job. */
export function tailTrace(stdout: string, max: number): { lines: string[]; truncated: boolean } {
  const lines = stdout
    .split(/\n/)
    .map((raw) => cleanLine(raw.replace(SECTION, '')))
    .filter((line, i, all) => line !== '' || i === all.length - 1);
  return tail(lines, max);
}

/** stderr is only classified, never shown or logged. */
export function classifyFailure(stderr: string): 'logged-out' | 'no-remote' | 'failed' {
  const s = stderr.toLowerCase();
  if (
    /auth login|not logged in|401|bad credentials|unauthorized|authentication|token .*(invalid|expired)/.test(
      s,
    )
  )
    return 'logged-out';
  if (/no git remote|known github host|could not determine|not a git repository|could not find .*project|404 project not found/.test(s))
    return 'no-remote';
  return 'failed';
}
