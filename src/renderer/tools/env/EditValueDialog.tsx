import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  EDITABLE_CONFIG_TYPES,
  type ConfigType,
  type EditableConfigType,
} from '@shared/tools/env/contract';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/errors';
import { TypedValueInput, typedValueError } from './TypedValueInput';

export interface EditTarget {
  mode: 'edit' | 'add';
  file: string;
  key: string;
  /** For add: the example file when it has a value for this key. */
  copyFrom: string | null;
}

interface Props {
  target: EditTarget | null;
  /** One value (and, for settings files, its type). */
  load(file: string, key: string): Promise<{ value: string; type?: ConfigType }>;
  /** Settings files: a type select (text, number, true/false, null). */
  typed?: boolean;
  onClose(): void;
  onSave(value: string, type: EditableConfigType): void;
}

/** An empty {} or [] is edited as a new text value. */
const editableType = (type: ConfigType | undefined): EditableConfigType =>
  EDITABLE_CONFIG_TYPES.find((t) => t === type) ?? 'string';

/** Edits or adds one value. Editing loads the current value (the user asked to see it). */
export function EditValueDialog({ target, load, typed = false, onClose, onSave }: Props) {
  const [value, setValue] = useState('');
  const [type, setType] = useState<EditableConfigType>('string');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setValue('');
    setType('string');
    if (target?.mode !== 'edit') return;
    let cancelled = false;
    setLoading(true);
    load(target.file, target.key)
      .then((v) => {
        if (cancelled) return;
        const t = editableType(v.type);
        setType(t);
        setValue(v.type === 'object' || v.type === 'array' || t === 'null' ? '' : v.value);
      })
      .catch((error: unknown) => {
        // Never leave an empty field that Save would write over the real value.
        toast.error(errorMessage(error));
        if (!cancelled) onClose();
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // load and onClose are fresh closures each render; the load must only rerun for a new target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const copyFromExample = async () => {
    if (!target?.copyFrom) return;
    try {
      setValue((await load(target.copyFrom, target.key)).value);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const invalid = typed && typedValueError(value, type) !== null;
  const title = target
    ? `${target.mode === 'edit' ? 'Edit' : 'Add'} ${target.key} ${target.mode === 'edit' ? 'in' : 'to'} ${target.file}`
    : '';
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
            if (!invalid) onSave(value, type);
          }}
        >
          {typed ? (
            <TypedValueInput
              value={value}
              type={type}
              disabled={loading}
              onChange={(v, t) => {
                setValue(v);
                setType(t);
              }}
            />
          ) : (
            <textarea
              aria-label="Value"
              value={value}
              disabled={loading}
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              rows={3}
              className="w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 font-mono text-xs text-fg outline-none focus-visible:border-brand"
            />
          )}
          {target?.copyFrom && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void copyFromExample()}>
              Copy from {target.copyFrom}
            </Button>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || invalid}>
              {target?.mode === 'add' ? 'Add' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
