import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { METHODS, type MockMethod, type MockRoute, RouteSchema } from '@shared/tools/mock/contract';
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

interface Draft {
  method: MockMethod;
  path: string;
  status: string;
  contentType: 'json' | 'text';
  headers: { name: string; value: string }[];
  body: string;
  delayMs: string;
  failStatus: string;
}

const NEW_DRAFT: Draft = {
  method: 'GET',
  path: '/',
  status: '200',
  contentType: 'json',
  headers: [],
  body: '{}',
  delayMs: '0',
  failStatus: '500',
};

function toDraft(route: MockRoute): Draft {
  return {
    method: route.method,
    path: route.path,
    status: String(route.status),
    contentType: route.contentType,
    headers: route.headers.map((h) => ({ ...h })),
    body: route.body,
    delayMs: String(route.delayMs),
    failStatus: String(route.fail.status),
  };
}

const FIELD_LABELS: Record<string, string> = {
  path: 'Path',
  status: 'Status',
  headers: 'Headers',
  body: 'Body',
  delayMs: 'Delay',
  fail: 'Fail status',
};

function Toggle<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  label: string;
  onChange(v: T): void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded border px-2 py-0.5 font-mono text-[11px]',
            value === o.value
              ? 'border-brand/40 bg-brand/15 text-brand'
              : 'border-line text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const inputClass = 'h-7 font-mono text-xs';

/** Adds a route (route null) or edits one. Validated with the same schema main uses. */
export function RouteEditor({
  open,
  route,
  onSave,
  onClose,
}: {
  open: boolean;
  route: MockRoute | null;
  onSave(route: MockRoute): void;
  onClose(): void;
}) {
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setDraft(route ? toDraft(route) : NEW_DRAFT);
    setProblem(null);
  }, [open, route]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    const parsed = RouteSchema.safeParse({
      id: route?.id ?? crypto.randomUUID(),
      enabled: route?.enabled ?? true,
      method: draft.method,
      path: draft.path.trim(),
      status: Number(draft.status),
      contentType: draft.contentType,
      headers: draft.headers
        .filter((h) => h.name.trim() !== '' || h.value !== '')
        .map((h) => ({ name: h.name.trim(), value: h.value })),
      body: draft.body,
      delayMs: Number(draft.delayMs || 0),
      fail: { on: route?.fail.on ?? false, status: Number(draft.failStatus) },
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = FIELD_LABELS[String(issue?.path[0] ?? '')] ?? 'Route';
      setProblem(`${field}: ${issue?.message ?? 'invalid'}`);
      return;
    }
    onSave(parsed.data);
  };

  const format = () => {
    try {
      set({ body: JSON.stringify(JSON.parse(draft.body), null, 2) });
      setProblem(null);
    } catch {
      setProblem('Body: Format needs valid JSON without placeholders outside strings');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{route ? 'Edit route' : 'Add route'}</DialogTitle>
          <DialogDescription>
            Use <code className="font-mono">:name</code> for a path segment and a final{' '}
            <code className="font-mono">*</code> for the rest. In the body,{' '}
            <code className="font-mono">{'{{params.name}}'}</code> and{' '}
            <code className="font-mono">{'{{query.name}}'}</code> are filled in.
          </DialogDescription>
        </DialogHeader>
        <form
          aria-label="Route"
          className="space-y-3 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Toggle
            label="Method"
            value={draft.method}
            options={METHODS.map((m) => ({ value: m, label: m }))}
            onChange={(method) => set({ method })}
          />
          <div className="flex gap-2">
            <Input
              aria-label="Path"
              value={draft.path}
              onChange={(e) => set({ path: e.target.value })}
              className={cn(inputClass, 'flex-1')}
            />
            <Input
              aria-label="Status"
              inputMode="numeric"
              value={draft.status}
              onChange={(e) => set({ status: e.target.value })}
              className={cn(inputClass, 'w-20')}
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-fg-muted">Headers</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set({ headers: [...draft.headers, { name: '', value: '' }] })}
              >
                <Plus className="size-3.5" aria-hidden />
                Add header
              </Button>
            </div>
            {draft.headers.map((h, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  aria-label={`Header ${i + 1} name`}
                  value={h.name}
                  onChange={(e) =>
                    set({
                      headers: draft.headers.map((x, j) =>
                        j === i ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                  className={cn(inputClass, 'w-48')}
                />
                <Input
                  aria-label={`Header ${i + 1} value`}
                  value={h.value}
                  onChange={(e) =>
                    set({
                      headers: draft.headers.map((x, j) =>
                        j === i ? { ...x, value: e.target.value } : x,
                      ),
                    })
                  }
                  className={cn(inputClass, 'flex-1')}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Remove header ${i + 1}`}
                  onClick={() => set({ headers: draft.headers.filter((_, j) => j !== i) })}
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Toggle
                label="Body type"
                value={draft.contentType}
                options={[
                  { value: 'json', label: 'JSON' },
                  { value: 'text', label: 'Text' },
                ]}
                onChange={(contentType) => set({ contentType })}
              />
              {draft.contentType === 'json' && (
                <Button type="button" variant="ghost" size="sm" onClick={format}>
                  Format
                </Button>
              )}
            </div>
            <textarea
              aria-label="Body"
              value={draft.body}
              spellCheck={false}
              rows={8}
              onChange={(e) => set({ body: e.target.value })}
              className="w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 font-mono text-xs text-fg outline-none focus-visible:border-brand"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-fg-muted">Delay</span>
            <Input
              aria-label="Delay (ms)"
              inputMode="numeric"
              value={draft.delayMs}
              onChange={(e) => set({ delayMs: e.target.value })}
              className={cn(inputClass, 'w-20')}
            />
            <span className="text-fg-muted">ms · when failing, answer</span>
            <Input
              aria-label="Fail status"
              inputMode="numeric"
              value={draft.failStatus}
              onChange={(e) => set({ failStatus: e.target.value })}
              className={cn(inputClass, 'w-20')}
            />
          </div>
          {problem && <p className="text-err">{problem}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{route ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
