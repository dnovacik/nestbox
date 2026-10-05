import { ExternalLink, Loader2, RefreshCw, Rocket, ScrollText, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  type Deployment,
  type DeployPlatform,
  PLATFORM_LABELS,
  type PlatformStatus,
} from '@shared/tools/deploy/contract';
import { LogView } from '@/components/log/LogView';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { EnvCompareRow } from './EnvCompare';
import { ReadySection } from './ReadySection';
import { SetupHelp } from './SetupHelp';
import { LISTING_TEXT, STATE_CLASS, STATE_LABEL } from './labels';
import {
  deployLogSource,
  useDeploy,
  useDeployCommand,
  useDeployments,
  useDeployStatus,
  usePackageName,
} from './use-deploy';

const open = (url: string) => void api.app.openExternal(url);

function LinkButton({ url, label, aria }: { url: string; label: string; aria?: string }) {
  return (
    <Button variant="ghost" size="sm" aria-label={aria} onClick={() => open(url)}>
      <ExternalLink className="size-3.5" aria-hidden />
      {label}
    </Button>
  );
}

function DeploymentRow({ d }: { d: Deployment }) {
  return (
    <tr className="border-t border-line/60">
      <td className="py-1.5 pr-3">
        <span className={cn('rounded border px-1.5 text-[10px]', STATE_CLASS[d.state])}>
          {STATE_LABEL[d.state]}
        </span>
      </td>
      <td className="pr-3 text-fg-muted">{d.environment ?? ''}</td>
      <td className="max-w-48 truncate pr-3 font-mono text-fg">{d.branch ?? ''}</td>
      <td className="pr-3 font-mono text-fg-faint">{d.label ?? ''}</td>
      <td className="pr-3 text-fg-muted">
        {d.createdAt === null ? '' : relativeTime(d.createdAt)}
      </td>
      <td className="text-right whitespace-nowrap">
        {d.url && <LinkButton url={d.url} label="Open" aria={`Open deployment ${d.id}`} />}
        {d.logsUrl && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Logs of deployment ${d.id}`}
            onClick={() => open(d.logsUrl ?? '')}
          >
            <ScrollText className="size-3.5" aria-hidden />
            Logs
          </Button>
        )}
      </td>
    </tr>
  );
}

function Listing({ projectId, p }: { projectId: string; p: PlatformStatus }) {
  const { data, isError, isFetching } = useDeployments(projectId, p.platform, true);
  const command = useDeployCommand(projectId);
  if (isError) return <p className="text-xs text-fg-muted">Couldn't list deployments.</p>;
  if (!data)
    return <p className="text-xs text-fg-muted">{isFetching ? 'Listing deployments…' : ''}</p>;
  if (data.state === 'site') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-fg-muted">Site</span>
        <span className="font-mono text-fg">{data.name ?? 'unknown'}</span>
        {data.url && <LinkButton url={data.url} label="Open site" />}
        {data.adminUrl && <LinkButton url={`${data.adminUrl}/deploys`} label="Deploy history" />}
      </div>
    );
  }
  if (data.state !== 'ok') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-fg-muted">{LISTING_TEXT[data.state]}</span>
        {data.state === 'logged-out' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => command.mutate({ method: 'login', platform: p.platform })}
          >
            Log in
          </Button>
        )}
      </div>
    );
  }
  if (data.deployments.length === 0)
    return <p className="text-xs text-fg-muted">No deployments yet.</p>;
  return (
    <table
      aria-label={`${PLATFORM_LABELS[p.platform]} deployments`}
      className="w-full text-left text-xs"
    >
      <thead className="text-[10px] tracking-wider text-fg-muted uppercase">
        <tr>
          <th className="pb-1 font-semibold">State</th>
          <th className="font-semibold">Environment</th>
          <th className="font-semibold">Branch</th>
          <th className="font-semibold" />
          <th className="font-semibold">When</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {data.deployments.map((d) => (
          <DeploymentRow key={d.id} d={d} />
        ))}
      </tbody>
    </table>
  );
}

interface PlatformProps {
  projectId: string;
  p: PlatformStatus;
  busy: boolean;
  running: boolean;
  envFiles: string[];
  defaultEnvFile: string | null;
  onDeploy(platform: DeployPlatform, target: 'preview' | 'production'): void;
}

function PlatformSection({
  projectId,
  p,
  busy,
  running,
  envFiles,
  defaultEnvFile,
  onDeploy,
}: PlatformProps) {
  const label = PLATFORM_LABELS[p.platform];
  const listing = useDeployments(projectId, p.platform, false);
  const command = useDeployCommand(projectId);
  const ready = p.cli !== 'missing' && p.linked;
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">{label}</h3>
        {p.name && <span className="font-mono text-xs text-fg-muted">{p.name}</span>}
        {p.flavour && (
          <span className="rounded border border-line px-1.5 text-[10px] text-fg-faint">
            {p.flavour === 'pages' ? 'Pages' : 'Workers'}
          </span>
        )}
        {p.cli === 'local' && <span className="text-[10px] text-fg-faint">project CLI</span>}
        <div className="ml-auto flex items-center gap-1">
          {p.dashboardUrl && <LinkButton url={p.dashboardUrl} label="Dashboard" />}
          {ready && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Refresh ${label} deployments`}
              disabled={listing.isFetching}
              onClick={() => void listing.refetch()}
            >
              <RefreshCw
                className={cn('size-3.5', listing.isFetching && 'animate-spin')}
                aria-hidden
              />
              Refresh
            </Button>
          )}
        </div>
      </div>

      {p.cli === 'missing' ? (
        <p className="text-xs text-fg-muted">
          {label}'s CLI isn't installed.{' '}
          {p.install.startsWith('https://') ? (
            <button
              type="button"
              className="text-brand hover:underline"
              onClick={() => open(p.install)}
            >
              Install instructions
            </button>
          ) : (
            <>
              Install it with <code className="font-mono text-fg select-all">{p.install}</code>
            </>
          )}
        </p>
      ) : (
        <>
          {p.hint && <p className="text-xs text-fg-muted">{p.hint}</p>}
          {p.canLink && (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => command.mutate({ method: 'link', platform: p.platform })}
            >
              Link in a terminal
            </Button>
          )}
          {(p.preview || p.production) && (
            <div className="flex flex-wrap gap-2">
              {p.preview && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onDeploy(p.platform, 'preview')}
                >
                  {running ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Rocket className="size-3.5" aria-hidden />
                  )}
                  Deploy preview
                </Button>
              )}
              {p.production && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-warn"
                  disabled={busy}
                  onClick={() => onDeploy(p.platform, 'production')}
                >
                  Deploy to production…
                </Button>
              )}
            </div>
          )}
          {ready && <Listing projectId={projectId} p={p} />}
          {ready && (
            <EnvCompareRow
              projectId={projectId}
              p={p}
              envFiles={envFiles}
              defaultEnvFile={defaultEnvFile}
            />
          )}
        </>
      )}
    </section>
  );
}

/** Each platform the package deploys to: its deployments and preview or confirmed production deploys. */
export default function DeployPanel({ projectId }: ToolPanelProps) {
  const { data: status, isError } = useDeployStatus(projectId);
  const deploy = useDeploy(projectId);
  const command = useDeployCommand(projectId);
  const packageName = usePackageName(projectId);
  const [confirm, setConfirm] = useState<DeployPlatform | null>(null);
  const source = useMemo(() => deployLogSource(projectId), [projectId]);

  if (isError) return <p className="text-sm text-fg-muted">Couldn't read the deploy settings.</p>;
  if (!status) return <p className="text-sm text-fg-muted">Loading…</p>;

  const busy = deploy.isPending || status.action !== null;
  const onDeploy = (platform: DeployPlatform, target: 'preview' | 'production') => {
    if (target === 'production') setConfirm(platform);
    else deploy.mutate({ platform, target });
  };
  const confirmTarget = status.platforms.find((p) => p.platform === confirm);

  return (
    <section aria-label="Deploy" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-fg">Deploy</h2>
        {status.last && !status.action && (
          <span className={cn('text-xs', status.last.ok ? 'text-fg-muted' : 'text-err')}>
            {status.last.ok ? 'Deployed' : 'Failed'}: {status.last.target} to{' '}
            {PLATFORM_LABELS[status.last.platform]} {relativeTime(status.last.at)}
          </span>
        )}
        {status.last?.ok && status.last.url && !status.action && (
          <LinkButton url={status.last.url} label="Open" aria="Open the last deploy" />
        )}
      </div>
      <p className="text-xs text-fg-faint">
        NestBox deploys through each platform's own CLI and its login, and keeps no tokens. Listing
        and deploying reach the platform; rollbacks stay in its dashboard.
      </p>
      <ReadySection projectId={projectId} scripts={status.scripts} ready={status.ready} />
      {status.platforms.length === 0 && <SetupHelp projectId={projectId} status={status} />}
      {status.platforms.map((p) => (
        <PlatformSection
          key={p.platform}
          projectId={projectId}
          p={p}
          busy={busy}
          running={status.action?.platform === p.platform}
          envFiles={status.envFiles}
          defaultEnvFile={status.defaultEnvFile}
          onDeploy={onDeploy}
        />
      ))}
      <div className="flex min-h-64 flex-1 flex-col">
        <LogView
          source={source}
          name="Deploy output"
          emptyHint="Output of Deploy preview and Deploy to production shows here."
          leading={
            status.action ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-err"
                onClick={() => command.mutate({ method: 'cancel' })}
              >
                <Square className="size-3.5" aria-hidden />
                Cancel deploy
              </Button>
            ) : undefined
          }
        />
      </div>
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deploy {packageName} to production on {confirm ? PLATFORM_LABELS[confirm] : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.name ? `${confirmTarget.name} goes live` : 'This goes live'} for
              everyone using the production URL. Rolling back happens in the platform's dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirm) deploy.mutate({ platform: confirm, target: 'production' });
                setConfirm(null);
              }}
            >
              Deploy to production
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
