import { useMutation } from '@tanstack/react-query';
import { Check, Circle, Loader2, Minus, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  DEFAULT_CHECK_SCRIPTS,
  type Readiness,
  type ReadyTone,
} from '@shared/tools/deploy/contract';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

const TONE_ICON: Record<ReadyTone, React.ReactNode> = {
  pending: <Circle className="size-3.5 text-fg-faint" aria-hidden />,
  running: <Loader2 className="size-3.5 animate-spin text-brand" aria-hidden />,
  ok: <Check className="size-3.5 text-ok" aria-hidden />,
  warn: <TriangleAlert className="size-3.5 text-warn" aria-hidden />,
  fail: <X className="size-3.5 text-err" aria-hidden />,
  skip: <Minus className="size-3.5 text-fg-faint" aria-hidden />,
};

const TONE_TEXT: Record<ReadyTone, string> = {
  pending: 'waiting',
  running: 'running',
  ok: 'passed',
  warn: 'warning',
  fail: 'failed',
  skip: 'skipped',
};

const SUMMARY: Record<'green' | 'amber' | 'red', { text: string; className: string }> = {
  green: { text: 'Ready to deploy', className: 'border-ok/40 text-ok' },
  amber: { text: 'Ready, with warnings', className: 'border-warn/40 text-warn' },
  red: { text: 'Not ready', className: 'border-err/40 text-err' },
};

interface Props {
  projectId: string;
  scripts: string[];
  ready: Readiness | null;
}

/** "Run checks": instant checks plus the picked scripts (run in the Scripts tab), summed up green, amber or red. */
export function ReadySection({ projectId, scripts, ready }: Props) {
  const [picked, setPicked] = useState(() =>
    DEFAULT_CHECK_SCRIPTS.filter((s) => scripts.includes(s)),
  );
  const run = useMutation({
    mutationFn: () => api.tools.invoke('deploy', projectId, 'checkReady', { scripts: picked }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const checking = run.isPending || (ready !== null && ready.overall === null);
  const toggle = (s: string) =>
    setPicked((current) =>
      current.includes(s) ? current.filter((x) => x !== s) : [...current, s],
    );

  return (
    <section
      aria-label="Ready to deploy"
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-fg">Ready to deploy</h3>
        {ready?.overall && (
          <span
            className={cn('rounded border px-1.5 text-[11px]', SUMMARY[ready.overall].className)}
          >
            {SUMMARY[ready.overall].text}
          </span>
        )}
        {ready?.overall && <span className="text-xs text-fg-faint">{relativeTime(ready.at)}</span>}
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          disabled={checking}
          onClick={() => run.mutate()}
        >
          {checking && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {checking ? 'Checking…' : 'Run checks'}
        </Button>
      </div>
      {scripts.length > 0 && (
        <div
          role="group"
          aria-label="Scripts to run"
          className="flex flex-wrap items-center gap-1.5 text-xs"
        >
          <span className="text-fg-muted">Scripts</span>
          {scripts.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={picked.includes(s)}
              disabled={checking}
              onClick={() => toggle(s)}
              className={cn(
                'rounded border px-2 py-0.5 font-mono text-[11px]',
                picked.includes(s)
                  ? 'border-brand/40 bg-brand/15 text-brand'
                  : 'border-line text-fg-muted hover:text-fg',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-fg-faint">
        Checks the Node version, the last dependency check, env keys on the platform and git, then
        runs the picked scripts one at a time (their output is in the Scripts tab).
      </p>
      {ready && (
        <ul aria-label="Checks" className="space-y-1 text-xs">
          {ready.checks.map((c, i) => (
            <li key={`${c.kind}-${c.label}-${i}`} className="flex items-start gap-2">
              <span className="mt-0.5" title={TONE_TEXT[c.tone]}>
                {TONE_ICON[c.tone]}
              </span>
              <span className={cn('w-28 shrink-0 text-fg', c.kind === 'script' && 'font-mono')}>
                {c.label}
              </span>
              <span className="sr-only">{TONE_TEXT[c.tone]}</span>
              <span className="text-fg-muted">{c.detail ?? ''}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
