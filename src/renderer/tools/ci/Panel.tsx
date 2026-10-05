import { ExternalLink, Loader2, LogIn, RefreshCw, RotateCcw, ScrollText } from 'lucide-react';
import { useState } from 'react';
import {
  type CiJob,
  type CiRun,
  type CiStatus,
  isActive,
  PROVIDER_LABELS,
} from '@shared/tools/ci/contract';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { FAILURE_TEXT, STATE_CLASS, STATE_LABEL } from './labels';
import {
  type CiScope,
  useCiJobLog,
  useCiJobs,
  useCiLogin,
  useCiRuns,
  useCiStatus,
  useRerunFailed,
} from './use-ci';

const open = (url: string) => void api.app.openExternal(url);

function StateBadge({ state }: { state: CiRun['state'] }) {
  return (
    <span className={cn('shrink-0 rounded border px-1.5 text-[10px]', STATE_CLASS[state])}>
      {STATE_LABEL[state]}
    </span>
  );
}

const runName = (run: CiRun) => run.title ?? run.workflow ?? `#${run.id}`;

function Setup({ status }: { status: CiStatus }) {
  if (status.provider === null)
    return (
      <section aria-label="Set up CI" className="space-y-2 text-xs text-fg-muted">
        <h2 className="text-sm font-medium text-fg">No GitHub or GitLab remote</h2>
        <p>
          NestBox reads the host of the <code className="font-mono">origin</code> remote. A{' '}
          <code className="font-mono">.github/workflows</code> folder or a{' '}
          <code className="font-mono">.gitlab-ci.yml</code> file also counts.
        </p>
      </section>
    );
  const cli = status.provider === 'github' ? 'gh' : 'glab';
  return (
    <section aria-label="Set up CI" className="space-y-2 text-xs text-fg-muted">
      <h2 className="text-sm font-medium text-fg">{PROVIDER_LABELS[status.provider]}</h2>
      <p>
        The <code className="font-mono">{cli}</code> CLI isn't installed. NestBox uses it and its
        login, and keeps no token.{' '}
        {status.install && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => open(status.install ?? '')}
          >
            How to install {cli}
          </Button>
        )}
      </p>
    </section>
  );
}

function JobLog({ projectId, runId, job }: { projectId: string; runId: string; job: CiJob }) {
  const { data, isLoading } = useCiJobLog(projectId, runId, job.id, true);
  if (isLoading || !data)
    return (
      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        <Loader2 className="size-3 animate-spin" aria-hidden /> Loading the log…
      </p>
    );
  if (data.state !== 'ok') return <p className="text-xs text-err">{FAILURE_TEXT[data.state]}</p>;
  return (
    <pre
      aria-label={`Log of ${job.name}`}
      className="max-h-80 overflow-auto rounded border border-line bg-surface p-2 font-mono text-[11px] leading-relaxed text-fg"
    >
      {data.truncated && (
        <span className="text-fg-faint">… earlier lines on the provider{'\n'}</span>
      )}
      {data.lines.length === 0 ? 'No failed step output.' : data.lines.join('\n')}
    </pre>
  );
}

function JobRow({ projectId, runId, job }: { projectId: string; runId: string; job: CiJob }) {
  const [showLog, setShowLog] = useState(false);
  const failed = job.state === 'failure';
  return (
    <li className="space-y-1.5 border-t border-line/60 py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <StateBadge state={job.state} />
        <span className="truncate text-fg">{job.name}</span>
        {job.stage && <span className="text-fg-faint">{job.stage}</span>}
        {job.allowFailure && failed && <span className="text-fg-faint">(allowed to fail)</span>}
        {job.failedStep && <span className="truncate text-err">· {job.failedStep}</span>}
        <span className="ml-auto flex shrink-0 items-center">
          {failed && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={showLog}
              aria-label={`${showLog ? 'Hide' : 'Show'} log of ${job.name}`}
              onClick={() => setShowLog((v) => !v)}
            >
              <ScrollText className="size-3.5" aria-hidden />
              {showLog ? 'Hide log' : 'Show log'}
            </Button>
          )}
          {job.url && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Open job ${job.name}`}
              onClick={() => open(job.url ?? '')}
            >
              <ExternalLink className="size-3.5" aria-hidden />
            </Button>
          )}
        </span>
      </div>
      {showLog && <JobLog projectId={projectId} runId={runId} job={job} />}
    </li>
  );
}

function RunDetail({ projectId, run }: { projectId: string; run: CiRun }) {
  const { data, isLoading, refetch, isFetching } = useCiJobs(
    projectId,
    run.id,
    isActive(run.state),
  );
  const rerun = useRerunFailed(projectId);
  const canRerun = run.state === 'failure';
  return (
    <section aria-label="Run details" className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex items-center gap-2">
        <StateBadge state={run.state} />
        <h3 className="truncate text-sm font-medium text-fg">{runName(run)}</h3>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {canRerun && (
            <Button
              variant="secondary"
              size="sm"
              disabled={rerun.isPending}
              onClick={() => rerun.mutate(run.id)}
            >
              {rerun.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <RotateCcw className="size-3.5" aria-hidden />
              )}
              Re-run failed jobs
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            aria-label="Refresh jobs"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} aria-hidden />
          </Button>
        </span>
      </div>
      <p className="text-xs text-fg-muted">
        {[run.workflow, run.branch, run.sha, run.event].filter(Boolean).join(' · ')}
      </p>
      {isLoading && (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Loader2 className="size-3 animate-spin" aria-hidden /> Loading jobs…
        </p>
      )}
      {data?.state === 'ok' && (
        <ul aria-label="Jobs">
          {data.jobs.map((job) => (
            <JobRow key={job.id} projectId={projectId} runId={run.id} job={job} />
          ))}
          {data.jobs.length === 0 && <li className="text-xs text-fg-faint">No jobs.</li>}
        </ul>
      )}
      {data && data.state !== 'ok' && (
        <p className="text-xs text-err">{FAILURE_TEXT[data.state]}</p>
      )}
    </section>
  );
}

function Runs({ projectId, status }: { projectId: string; status: CiStatus }) {
  const [scope, setScope] = useState<CiScope>(status.branch === null ? 'all' : 'branch');
  const [selected, setSelected] = useState<string | null>(null);
  const runs = useCiRuns(projectId, scope, true);
  const login = useCiLogin(projectId);
  const list = runs.data?.state === 'ok' ? runs.data.runs : [];
  const current = list.find((r) => r.id === selected) ?? list[0] ?? null;
  const following = list.some((r) => isActive(r.state));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-fg">
          {status.provider ? PROVIDER_LABELS[status.provider] : 'CI'}
        </h2>
        <div
          role="group"
          aria-label="Which runs"
          className="flex rounded-md border border-line p-0.5"
        >
          {(['branch', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              disabled={s === 'branch' && status.branch === null}
              onClick={() => {
                setScope(s);
                setSelected(null);
              }}
              className={cn(
                'rounded px-2 py-0.5 text-xs',
                scope === s ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg',
              )}
            >
              {s === 'branch' ? (status.branch ?? 'This branch') : 'All branches'}
            </button>
          ))}
        </div>
        {following && (
          <span className="flex items-center gap-1 text-xs text-brand">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Following
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          aria-label="Refresh runs"
          disabled={runs.isFetching}
          onClick={() => void runs.refetch()}
        >
          <RefreshCw className={cn('size-3.5', runs.isFetching && 'animate-spin')} aria-hidden />
          Refresh
        </Button>
      </div>
      {runs.isLoading && (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Loader2 className="size-3 animate-spin" aria-hidden /> Loading runs…
        </p>
      )}
      {runs.data && runs.data.state !== 'ok' && (
        <div className="space-y-2 text-xs">
          <p className="text-err">{FAILURE_TEXT[runs.data.state]}</p>
          {runs.data.state === 'logged-out' && (
            <Button variant="secondary" size="sm" onClick={() => login.mutate()}>
              <LogIn className="size-3.5" aria-hidden />
              Log in
            </Button>
          )}
        </div>
      )}
      {runs.data?.state === 'ok' && list.length === 0 && (
        <p className="text-xs text-fg-faint">
          No runs{scope === 'branch' ? ' for this branch' : ''} yet.
        </p>
      )}
      {list.length > 0 && (
        <ul aria-label="Runs" className="divide-y divide-line/60 rounded-lg border border-line">
          {list.map((run) => (
            <li
              key={run.id}
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 text-xs',
                current?.id === run.id && 'bg-surface/60',
              )}
            >
              <button
                type="button"
                aria-current={current?.id === run.id}
                aria-label={`Run ${runName(run)}`}
                onClick={() => setSelected(run.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <StateBadge state={run.state} />
                <span className="truncate text-fg">{runName(run)}</span>
                <span className="hidden shrink-0 text-fg-faint sm:inline">
                  {[run.workflow, scope === 'all' ? run.branch : null].filter(Boolean).join(' · ')}
                </span>
                <span className="ml-auto shrink-0 text-fg-muted">
                  {run.createdAt === null ? '' : relativeTime(run.createdAt)}
                </span>
              </button>
              {run.url && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Open run ${runName(run)}`}
                  onClick={() => open(run.url ?? '')}
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {current && <RunDetail key={current.id} projectId={projectId} run={current} />}
    </div>
  );
}

export default function CiPanel({ projectId }: ToolPanelProps) {
  const { data: status, isError } = useCiStatus(projectId);
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {isError && <p className="text-xs text-err">Couldn't read the repository's CI settings.</p>}
      {!status && !isError && (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Loader2 className="size-3 animate-spin" aria-hidden /> Loading…
        </p>
      )}
      {status &&
        (status.provider === null || status.cli === 'missing' ? (
          <Setup status={status} />
        ) : (
          <Runs projectId={projectId} status={status} />
        ))}
    </div>
  );
}
