import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  type EntryDetail,
  type SendInput,
  SendInputSchema,
} from '@shared/tools/inspector/contract';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** A header row; `keep` means "send the recorded value", which the renderer never saw. */
interface Row {
  name: string;
  value: string;
  keep: boolean;
}

const SKIP = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
]);
const inputClass = 'h-7 font-mono text-xs';

function rowsOf(detail: EntryDetail): Row[] {
  return detail.request.headers
    .filter((h) => !SKIP.has(h.name.toLowerCase()))
    .map((h) => ({ name: h.name, value: h.masked ? '' : h.value, keep: h.masked }));
}

function bodyOf(detail: EntryDetail): string {
  const body = detail.request.body;
  return body.kind === 'text' && !body.truncated ? body.text : '';
}

/** Edits a recorded request and sends it to the API. Masked headers stay in main unless changed here. */
export function SendDialog({
  detail,
  onSend,
  onClose,
}: {
  detail: EntryDetail | null;
  onSend(input: SendInput): void;
  onClose(): void;
}) {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/');
  const [rows, setRows] = useState<Row[]>([]);
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!detail) return;
    setMethod(detail.summary.method);
    setPath(detail.summary.path);
    setRows(rowsOf(detail));
    setBody(bodyOf(detail));
    setProblem(null);
  }, [detail]);
  const original = detail?.request.body;
  const bodyLost =
    original !== undefined &&
    (original.kind === 'binary' || (original.kind === 'text' && original.truncated));
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const send = () => {
    if (!detail) return;
    const parsed = SendInputSchema.safeParse({
      from: detail.summary.id,
      method: method.trim().toUpperCase(),
      path: path.trim(),
      headers: rows
        .filter((r) => r.name.trim() !== '')
        .map((r) =>
          r.keep
            ? { name: r.name.trim(), keep: true as const }
            : { name: r.name.trim(), value: r.value },
        ),
      body,
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Invalid request');
      return;
    }
    onSend(parsed.data);
  };

  return (
    <Dialog open={detail !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit & send</DialogTitle>
          <DialogDescription>
            Goes straight to the API and is recorded as a replay. Masked headers send their recorded
            value unless you type a new one.
          </DialogDescription>
        </DialogHeader>
        <form
          aria-label="Edit request"
          className="space-y-3 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="flex gap-2">
            <Input
              aria-label="Method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={cn(inputClass, 'w-24')}
            />
            <Input
              aria-label="Path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className={cn(inputClass, 'flex-1')}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-fg-muted">Headers</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRows((rs) => [...rs, { name: '', value: '', keep: false }])}
              >
                <Plus className="size-3.5" aria-hidden />
                Add header
              </Button>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  aria-label={`Header ${i + 1} name`}
                  value={r.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                  className={cn(inputClass, 'w-48')}
                />
                <Input
                  aria-label={`Header ${i + 1} value`}
                  value={r.value}
                  placeholder={r.keep ? 'recorded value' : undefined}
                  onChange={(e) => setRow(i, { value: e.target.value, keep: false })}
                  className={cn(inputClass, 'flex-1')}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Remove header ${i + 1}`}
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
          {bodyLost && (
            <p className="text-warn">
              The recorded body wasn't kept in full, so it starts empty here.
            </p>
          )}
          <textarea
            aria-label="Body"
            value={body}
            spellCheck={false}
            rows={8}
            onChange={(e) => setBody(e.target.value)}
            className="w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 font-mono text-xs text-fg outline-none focus-visible:border-brand"
          />
          {problem && <p className="text-err">{problem}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Send</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
