import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  type EnvCompare,
  PLATFORM_LABELS,
  type PlatformStatus,
} from '@shared/tools/deploy/contract';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { LISTING_TEXT } from './labels';

interface Props {
  projectId: string;
  p: PlatformStatus;
  envFiles: string[];
  defaultEnvFile: string | null;
}

function KeyGroup({ title, keys, tone }: { title: string; keys: string[]; tone: string }) {
  if (keys.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className={cn('text-[11px] font-semibold', tone)}>
        {title} ({keys.length})
      </p>
      <ul aria-label={title} className="flex flex-wrap gap-1.5">
        {keys.map((k) => (
          <li key={k} className="rounded border border-line px-1.5 font-mono text-[11px] text-fg">
            {k}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The platform's variable names for one environment against a local env file's: never values. */
export function EnvCompareRow({ projectId, p, envFiles, defaultEnvFile }: Props) {
  const label = PLATFORM_LABELS[p.platform];
  const [environment, setEnvironment] = useState(p.environments[0] ?? '');
  const [file, setFile] = useState(defaultEnvFile ?? '');
  const compare = useMutation({
    mutationFn: (): Promise<EnvCompare> =>
      api.tools.invoke('deploy', projectId, 'envCompare', {
        platform: p.platform,
        environment,
        file,
      }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const result = compare.data;
  if (envFiles.length === 0)
    return <p className="text-xs text-fg-faint">No env file to compare with {label}.</p>;
  return (
    <div
      role="group"
      aria-label={`${label} env`}
      className="space-y-2 border-t border-line/60 pt-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-fg-muted">Env</span>
        <Select
          value={file}
          onValueChange={(v) => {
            setFile(v);
            compare.reset();
          }}
        >
          <SelectTrigger size="sm" aria-label="Local env file" className="h-7 font-mono text-xs">
            <SelectValue placeholder="Env file" />
          </SelectTrigger>
          <SelectContent>
            {envFiles.map((f) => (
              <SelectItem key={f} value={f} className="font-mono text-xs">
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-fg-muted">vs</span>
        <Select
          value={environment}
          onValueChange={(v) => {
            setEnvironment(v);
            compare.reset();
          }}
        >
          <SelectTrigger size="sm" aria-label={`${label} environment`} className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {p.environments.map((e) => (
              <SelectItem key={e} value={e} className="text-xs">
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="secondary"
          size="sm"
          disabled={compare.isPending || file === '' || environment === ''}
          onClick={() => compare.mutate()}
        >
          {compare.isPending ? 'Comparing…' : 'Compare'}
        </Button>
      </div>
      {result && result.state !== 'ok' && (
        <p className="text-xs text-fg-muted">
          {result.state === 'no-file' ? `${file} is gone.` : LISTING_TEXT[result.state]}
        </p>
      )}
      {result?.state === 'ok' && (
        <div className="space-y-2">
          {result.onlyLocal.length === 0 && result.onlyRemote.length === 0 ? (
            <p className="text-xs text-ok">
              Same {result.both.length} keys in {file} and on {label} ({environment}).
            </p>
          ) : (
            <p className="text-xs text-fg-muted">{result.both.length} keys in both.</p>
          )}
          <KeyGroup title={`Missing on ${label}`} keys={result.onlyLocal} tone="text-warn" />
          <KeyGroup title={`Only on ${label}`} keys={result.onlyRemote} tone="text-fg-muted" />
        </div>
      )}
    </div>
  );
}
