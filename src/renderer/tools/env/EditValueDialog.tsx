import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/errors';
import { revealValue } from './use-env';

export interface EditTarget {
  mode: 'edit' | 'add';
  file: string;
  key: string;
  /** For add: the example file when it has a value for this key. */
  copyFrom: string | null;
}

interface Props {
  projectId: string;
  target: EditTarget | null;
  onClose(): void;
  onSave(value: string): void;
}

/** Edits or adds one value. Editing loads the current value (the user asked to see it). */
export function EditValueDialog({ projectId, target, onClose, onSave }: Props) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setValue('');
    if (target?.mode !== 'edit') return;
    let cancelled = false;
    setLoading(true);
    revealValue(projectId, target.file, target.key)
      .then((v) => !cancelled && setValue(v))
      .catch((error: unknown) => {
        // Never leave an empty field that Save would write over the real value.
        toast.error(errorMessage(error));
        if (!cancelled) onClose();
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // onClose is a fresh closure each render; the load must only rerun for a new target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, target]);

  const copyFromExample = async () => {
    if (!target?.copyFrom) return;
    try {
      setValue(await revealValue(projectId, target.copyFrom, target.key));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const title = target ? `${target.mode === 'edit' ? 'Edit' : 'Add'} ${target.key} ${target.mode === 'edit' ? 'in' : 'to'} ${target.file}` : '';
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Comments and the rest of the file stay as they are.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(value);
          }}
        >
          <textarea
            aria-label="Value"
            value={value}
            disabled={loading}
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 font-mono text-xs text-fg outline-none focus-visible:border-brand"
          />
          {target?.copyFrom && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void copyFromExample()}>
              Copy from {target.copyFrom}
            </Button>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {target?.mode === 'add' ? 'Add' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
