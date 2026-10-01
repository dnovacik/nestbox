import { Copy, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/errors';
import { revealValue } from './use-env';

/** A revealed value hides itself after this long, even if the cell keeps focus. */
const REVEAL_MS = 30_000;

export type CellState = 'set' | 'empty' | 'absent';

interface Props {
  projectId: string;
  file: string;
  envKey: string;
  state: CellState;
  readOnly: boolean;
  onCopy(): void;
  onEdit(): void;
  onAdd(): void;
  onRemove(): void;
}

function IconButton({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded p-0.5 text-fg-faint hover:bg-surface hover:text-fg focus-visible:text-fg"
    >
      {children}
    </button>
  );
}

/** One key in one file: masked by default; reveal shows this value only, until focus leaves the cell. */
export function ValueCell({ projectId, file, envKey, state, readOnly, onCopy, onEdit, onAdd, onRemove }: Props) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = () => {
    clearTimeout(timer.current);
    setRevealed(null);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const reveal = async () => {
    try {
      setRevealed(await revealValue(projectId, file, envKey));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setRevealed(null), REVEAL_MS);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (state === 'absent') {
    return readOnly ? (
      <span className="text-fg-faint">—</span>
    ) : (
      <IconButton label={`Add ${envKey} to ${file}`} onClick={onAdd}>
        <Plus className="size-3.5" />
      </IconButton>
    );
  }

  return (
    <div
      className="group flex min-w-0 items-center gap-1"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hide();
      }}
    >
      {revealed !== null ? (
        <code className="min-w-0 truncate rounded bg-app px-1 text-fg" title={revealed}>
          {revealed === '' ? '(empty)' : revealed}
        </code>
      ) : state === 'empty' ? (
        <span className="text-fg-faint italic">empty</span>
      ) : (
        <span aria-hidden className="tracking-widest text-fg-muted">
          ••••••
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center opacity-60 group-focus-within:opacity-100 group-hover:opacity-100">
        {state === 'set' &&
          (revealed === null ? (
            <IconButton label={`Reveal ${envKey} in ${file}`} onClick={() => void reveal()}>
              <Eye className="size-3.5" />
            </IconButton>
          ) : (
            <IconButton label={`Hide ${envKey} in ${file}`} onClick={hide}>
              <EyeOff className="size-3.5" />
            </IconButton>
          ))}
        {state === 'set' && (
          <IconButton label={`Copy ${envKey} from ${file}`} onClick={onCopy}>
            <Copy className="size-3.5" />
          </IconButton>
        )}
        {!readOnly && (
          <>
            <IconButton label={`Edit ${envKey} in ${file}`} onClick={onEdit}>
              <Pencil className="size-3.5" />
            </IconButton>
            <IconButton label={`Remove ${envKey} from ${file}`} onClick={onRemove}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </>
        )}
      </span>
    </div>
  );
}
