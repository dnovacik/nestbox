import { Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import {
  type CheckInput,
  type CheckView,
  type HealthStatus,
  HttpUrlSchema,
  MAX_CHECKS,
  PathSchema,
  StatusSchema,
} from '@shared/tools/health/contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { relativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import type { ToolPanelProps } from '../types';
import { checkTone, DOT_CLASS, INTERVALS, intervalLabel, resultText, TONE_LABEL } from './labels';
import { useHealth, useHealthActions } from './use-health';

function CheckRow({ check, projectId }: { check: CheckView; projectId: string }) {
  const { remove } = useHealthActions(projectId);
  const tone = checkTone(check.result);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 text-xs">
      <span
        title={TONE_LABEL[tone]}
        className={cn('size-2 shrink-0 rounded-full', DOT_CLASS[tone])}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-fg">{check.label}</p>
        <p className="text-fg-faint">
          {check.kind === 'env' ? 'from .env' : 'URL'}
          {check.expect !== null && ` · expects ${check.expect}`}
          {check.result && ` · checked ${relativeTime(check.result.at)}`}
        </p>
      </div>
      <span
        className={cn(
          'shrink-0 font-mono',
          tone === 'err' ? 'text-err' : tone === 'warn' ? 'text-warn' : 'text-fg-muted',
        )}
      >
        {resultText(check)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={`Remove ${check.label}`}
        disabled={remove.isPending}
        onClick={() => remove.mutate(check.id)}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </Button>
    </li>
  );
}

function AddForm({ status, projectId }: { status: HealthStatus; projectId: string }) {
  const { add } = useHealthActions(projectId);
  const envKeys = status.suggestions.envKeys;
  const [kind, setKind] = useState<'url' | 'env'>('url');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [path, setPath] = useState('/');
  const [expect, setExpect] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let expected: number | undefined;
    if (expect.trim() !== '') {
      const parsed = StatusSchema.safeParse(Number(expect));
      if (!parsed.success) return setProblem('The expected status is a number from 100 to 599');
      expected = parsed.data;
    }
    let check: CheckInput;
    if (kind === 'url') {
      const parsed = HttpUrlSchema.safeParse(url);
      if (!parsed.success) return setProblem('An http(s) URL without a user or password');
      check = { kind: 'url', url: parsed.data };
    } else {
      if (!key) return setProblem('Pick an env key');
      const parsed = PathSchema.safeParse(path.trim() || '/');
      if (!parsed.success) return setProblem('The path starts with / and has no spaces');
      check = { kind: 'env', key, path: parsed.data };
    }
    setProblem(null);
    add.mutate(expected === undefined ? check : { ...check, expect: expected }, {
      onSuccess: () => {
        setUrl('');
        setExpect('');
      },
    });
  };

  const kindButton = (value: 'url' | 'env', label: string, disabled = false) => (
    <button
      type="button"
      aria-pressed={kind === value}
      disabled={disabled}
      title={disabled ? 'No URL-like keys in .env' : undefined}
      onClick={() => setKind(value)}
      className={cn(
        'rounded border px-2 py-0.5 text-[11px] disabled:opacity-50',
        kind === value
          ? 'border-brand/40 bg-brand/15 text-brand'
          : 'border-line text-fg-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );

  return (
    <form
      aria-label="Add check"
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <h3 className="mr-2 text-[10px] font-semibold tracking-wider text-fg-muted uppercase">
          Add check
        </h3>
        {kindButton('url', 'URL')}
        {kindButton('env', 'From .env', envKeys.length === 0)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {kind === 'url' ? (
          <Input
            aria-label="URL"
            placeholder="http://localhost:3000/health"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="h-7 min-w-64 flex-1 font-mono text-xs"
          />
        ) : (
          <>
            <Select value={key} onValueChange={setKey}>
              <SelectTrigger size="sm" aria-label="Env key" className="h-7 w-48 font-mono text-xs">
                <SelectValue placeholder="Env key" />
              </SelectTrigger>
              <SelectContent>
                {envKeys.map((k) => (
                  <SelectItem key={k} value={k} className="font-mono text-xs">
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="h-7 w-40 font-mono text-xs"
            />
          </>
        )}
        <Input
          aria-label="Expected status"
          inputMode="numeric"
          placeholder="2xx/3xx"
          value={expect}
          onChange={(e) => setExpect(e.target.value)}
          className="h-7 w-24 font-mono text-xs"
        />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={add.isPending || status.checks.length >= MAX_CHECKS}
        >
          <Plus className="size-3.5" aria-hidden />
          Add
        </Button>
      </div>
      {problem && <p className="text-xs text-err">{problem}</p>}
    </form>
  );
}

function Suggestions({ status, projectId }: { status: HealthStatus; projectId: string }) {
  const { add } = useHealthActions(projectId);
  const { port, envKeys } = status.suggestions;
  if (port === null && envKeys.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Suggestions"
      className="flex flex-wrap items-center gap-2 text-xs"
    >
      <span className="text-fg-muted">Suggestions</span>
      {port !== null && (
        <Button
          variant="secondary"
          size="sm"
          className="font-mono"
          disabled={add.isPending}
          onClick={() => add.mutate({ kind: 'url', url: `http://localhost:${port}/` })}
        >
          {`http://localhost:${port}/`}
        </Button>
      )}
      {envKeys.map((key) => (
        <Button
          key={key}
          variant="secondary"
          size="sm"
          className="font-mono"
          title={`The origin of ${key} in .env`}
          disabled={add.isPending}
          onClick={() => add.mutate({ kind: 'env', key, path: '/' })}
        >
          {key}
        </Button>
      ))}
    </div>
  );
}

/** HTTP checks that run while the package's scripts run, with a notice when one starts failing. */
export default function HealthPanel({ projectId }: ToolPanelProps) {
  const { data: status, isError } = useHealth(projectId);
  const { checkNow, setOptions } = useHealthActions(projectId);
  if (isError) return <p className="text-sm text-fg-muted">Couldn't read the health checks.</p>;
  if (!status) return <p className="text-sm text-fg-muted">Loading…</p>;
  const intervals = INTERVALS.some((i) => i === status.intervalSec)
    ? INTERVALS
    : [...INTERVALS, status.intervalSec].sort((a, b) => a - b);
  return (
    <section aria-label="Health" className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-fg">Health</h2>
        <span className={cn('text-xs', status.live ? 'text-ok' : 'text-fg-faint')}>
          {status.live ? 'Running' : 'Idle (no scripts running)'}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            Every
            <Select
              value={String(status.intervalSec)}
              onValueChange={(v) => setOptions.mutate({ intervalSec: Number(v) })}
            >
              <SelectTrigger size="sm" aria-label="Interval" className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {intervals.map((sec) => (
                  <SelectItem key={sec} value={String(sec)} className="text-xs">
                    {intervalLabel(sec)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <Switch
              aria-label="Notify when a check starts failing"
              checked={status.notify}
              onCheckedChange={(notify) => setOptions.mutate({ notify })}
            />
            Notify
          </label>
          <Button
            variant="secondary"
            size="sm"
            disabled={checkNow.isPending || status.checks.length === 0}
            onClick={() => checkNow.mutate()}
          >
            {checkNow.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden />
            )}
            Check now
          </Button>
        </div>
      </div>
      {status.checks.length === 0 ? (
        <p className="text-xs text-fg-muted">
          No checks yet. Checks run while a script of this package runs.
        </p>
      ) : (
        <ul
          aria-label="Checks"
          className="divide-y divide-line rounded-lg border border-line bg-card"
        >
          {status.checks.map((check) => (
            <CheckRow key={check.id} check={check} projectId={projectId} />
          ))}
        </ul>
      )}
      <Suggestions status={status} projectId={projectId} />
      <AddForm status={status} projectId={projectId} />
    </section>
  );
}
