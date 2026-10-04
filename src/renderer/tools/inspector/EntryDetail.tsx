import { Clipboard, Eye, Pencil, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BodyView, EntryDetail as Detail, SideView } from '@shared/tools/inspector/contract';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { formatBytes, prettyBody, statusTone } from './labels';
import { revealHeader, useInspectorActions, useInspectorEntry } from './use-inspector';

function Body({ body }: { body: BodyView }) {
  if (body.kind === 'none') return <p className="text-xs text-fg-faint">No body</p>;
  if (body.kind === 'binary')
    return (
      <p className="text-xs text-fg-muted">
        Binary, {formatBytes(body.bytes)}
        {body.truncated && ' (only the start was kept)'}
      </p>
    );
  return (
    <div className="space-y-1">
      {body.truncated && <p className="text-xs text-warn">Only the first 256 KB was kept.</p>}
      <pre
        aria-label="Body"
        className="max-h-80 overflow-auto rounded-md border border-line bg-app p-2 font-mono text-[11px] whitespace-pre-wrap text-fg"
      >
        {prettyBody(body.text, body.contentType)}
      </pre>
    </div>
  );
}

function Headers({
  projectId,
  entryId,
  side,
  view,
}: {
  projectId: string;
  entryId: string;
  side: 'request' | 'response';
  view: SideView;
}) {
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setRevealed({}), [entryId, side]);
  const reveal = async (name: string) => {
    try {
      const value = await revealHeader(projectId, entryId, side, name);
      setRevealed((r) => ({ ...r, [name]: value }));
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };
  if (view.headers.length === 0) return <p className="text-xs text-fg-faint">No headers</p>;
  return (
    <>
      <table
        aria-label={`${side === 'request' ? 'Request' : 'Response'} headers`}
        className="w-full text-xs"
      >
        <tbody>
          {view.headers.map((h, i) => (
            <tr key={`${h.name}-${i}`} className="align-top">
              <td className="w-48 py-0.5 pr-3 font-mono text-fg-muted">{h.name}</td>
              <td className="py-0.5 font-mono break-all text-fg">
                {h.masked && revealed[h.name] === undefined ? (
                  <span className="inline-flex items-center gap-2">
                    {h.value}
                    <button
                      type="button"
                      aria-label={`Reveal ${h.name}`}
                      className="text-brand hover:text-brand-hover"
                      onClick={() => void reveal(h.name)}
                    >
                      <Eye className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ) : (
                  (revealed[h.name] ?? h.value)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {problem && <p className="text-xs text-err">{problem}</p>}
    </>
  );
}

/** One recorded request and its response, with Replay, Edit & send and Copy as curl. */
export function EntryDetail({
  projectId,
  id,
  onEdit,
}: {
  projectId: string;
  id: string;
  onEdit(detail: Detail): void;
}) {
  const { data: detail, isError, error } = useInspectorEntry(projectId, id);
  const actions = useInspectorActions(projectId);
  const [side, setSide] = useState<'request' | 'response'>('response');
  if (isError) return <p className="text-xs text-fg-muted">{errorMessage(error)}</p>;
  if (!detail) return <p className="text-xs text-fg-muted">Loading…</p>;
  const s = detail.summary;
  const view = side === 'request' ? detail.request : detail.response;
  const tab = (value: 'request' | 'response', label: string) => (
    <button
      type="button"
      aria-pressed={side === value}
      onClick={() => setSide(value)}
      className={cn(
        'rounded border px-2 py-0.5 text-[11px]',
        side === value
          ? 'border-brand/40 bg-brand/15 text-brand'
          : 'border-line text-fg-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );
  return (
    <section aria-label="Request detail" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-brand">{s.method}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-fg" title={s.path}>
          {s.path}
        </span>
        <span className={cn('font-mono', statusTone(s.status))}>{s.status ?? s.error}</span>
        {s.ms !== null && <span className="text-fg-faint">{s.ms} ms</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={actions.replay.isPending}
          onClick={() => actions.replay.mutate(s.id)}
        >
          <RotateCw
            className={cn('size-3.5', actions.replay.isPending && 'animate-spin')}
            aria-hidden
          />
          Replay
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onEdit(detail)}>
          <Pencil className="size-3.5" aria-hidden />
          Edit & send
        </Button>
        <Button variant="ghost" size="sm" onClick={() => actions.copyCurl.mutate(s.id)}>
          <Clipboard className="size-3.5" aria-hidden />
          Copy as curl
        </Button>
      </div>
      <div className="flex gap-1.5">
        {tab('request', 'Request')}
        {tab('response', 'Response')}
      </div>
      {view ? (
        <div className="space-y-3">
          <Headers projectId={projectId} entryId={s.id} side={side} view={view} />
          <Body body={view.body} />
        </div>
      ) : (
        <p className="text-xs text-fg-muted">No response{s.error ? ` (${s.error})` : ''}.</p>
      )}
    </section>
  );
}
