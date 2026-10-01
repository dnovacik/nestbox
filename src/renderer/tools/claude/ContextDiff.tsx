import { useQuery, useQueryClient } from '@tanstack/react-query';
import { diffLines } from 'diff';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { queryKeys } from '@/lib/queries';
import { docKey } from './use-claude';

/** Unchanged runs longer than this are folded to their first and last CONTEXT lines. */
const CONTEXT = 3;

type Row = { kind: 'add' | 'remove' | 'same'; text: string } | { kind: 'fold'; count: number };

export function diffRows(before: string, after: string): Row[] {
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  const rows: Row[] = [];
  for (const part of diffLines(lf(before), lf(after))) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.added || part.removed) {
      for (const text of lines) rows.push({ kind: part.added ? 'add' : 'remove', text });
    } else if (lines.length > CONTEXT * 2 + 1) {
      rows.push(...lines.slice(0, CONTEXT).map((text) => ({ kind: 'same' as const, text })));
      rows.push({ kind: 'fold', count: lines.length - CONTEXT * 2 });
      rows.push(...lines.slice(-CONTEXT).map((text) => ({ kind: 'same' as const, text })));
    } else {
      for (const text of lines) rows.push({ kind: 'same', text });
    }
  }
  return rows;
}

const ROW_CLASS = { add: 'bg-ok/10 text-ok', remove: 'bg-err/10 text-err', same: 'text-fg-muted' } as const;
const MARK = { add: '+', remove: '-', same: ' ' } as const;

/** Shows what "Update context" would change in CLAUDE.md, and applies it with the version it showed. */
export function ContextDiff({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const previewKey = queryKeys.tool('claude', projectId, 'contextPreview');
  const { data, error } = useQuery({
    queryKey: previewKey,
    queryFn: () => api.tools.invoke('claude', projectId, 'contextPreview', {}),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });
  const rows = useMemo(() => (data ? diffRows(data.before, data.after) : []), [data]);
  const unchanged = data !== undefined && data.before === data.after;

  const apply = async () => {
    if (!data) return;
    setApplying(true);
    try {
      await api.tools.invoke('claude', projectId, 'applyContext', { version: data.version });
      toast.success('Updated the context in CLAUDE.md');
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: docKey(projectId, 'CLAUDE.md') });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tool('claude', projectId, 'status') });
    } catch (e) {
      toast.error(errorMessage(e));
      void queryClient.invalidateQueries({ queryKey: previewKey });
    } finally {
      setApplying(false);
    }
  };

  return (
    <section aria-label="Project context" className="flex flex-col gap-3 rounded-lg border border-line bg-card p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold tracking-wider text-fg-muted uppercase">Project context</h3>
        <span className="text-[11px] text-fg-faint">Scripts, run groups, packages and env key names, kept between NestBox markers in CLAUDE.md.</span>
        {!open && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setOpen(true)}>
            Preview update
          </Button>
        )}
      </div>
      {open && (
        <>
          {error ? (
            <p className="text-xs text-err">{errorMessage(error)}</p>
          ) : !data ? (
            <p className="text-xs text-fg-muted">Loading…</p>
          ) : unchanged ? (
            <p className="text-xs text-fg-muted">CLAUDE.md is already up to date.</p>
          ) : (
            <div role="region" aria-label="Changes to CLAUDE.md" className="max-h-96 overflow-auto rounded-md bg-surface py-2 font-mono text-xs">
              {rows.map((row, i) =>
                row.kind === 'fold' ? (
                  <div key={i} className="px-3 text-fg-faint">
                    … {row.count} unchanged lines
                  </div>
                ) : (
                  <div key={i} className={`px-3 whitespace-pre-wrap ${ROW_CLASS[row.kind]}`} data-kind={row.kind}>
                    {MARK[row.kind]} {row.text}
                  </div>
                ),
              )}
            </div>
          )}
          <div className="flex gap-2">
            {data && !unchanged && (
              <Button size="sm" onClick={() => void apply()} disabled={applying}>
                {data.version === null ? 'Create CLAUDE.md' : 'Apply'}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
