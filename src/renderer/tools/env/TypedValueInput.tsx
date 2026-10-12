import {
  EDITABLE_CONFIG_TYPES,
  JSON_NUMBER,
  type EditableConfigType,
} from '@shared/tools/env/contract';
import { Input } from '@/components/ui/input';

const LABELS: Record<EditableConfigType, string> = {
  string: 'Text',
  number: 'Number',
  boolean: 'true / false',
  null: 'null',
};

/** Why value can't be saved as type, or null. */
export function typedValueError(value: string, type: EditableConfigType): string | null {
  if (
    type === 'number' &&
    (!JSON_NUMBER.test(value.trim()) || !Number.isFinite(Number(value.trim())))
  )
    return 'Not a number.';
  if (type === 'boolean' && value !== 'true' && value !== 'false') return 'Pick true or false.';
  return null;
}

const textarea =
  'w-full resize-y rounded-md border border-line bg-app px-2 py-1.5 font-mono text-xs text-fg outline-none focus-visible:border-brand';
const select = 'h-8 w-full rounded-md border border-line bg-app px-2 font-mono text-xs text-fg';

interface Props {
  value: string;
  type: EditableConfigType;
  disabled?: boolean;
  onChange(value: string, type: EditableConfigType): void;
}

/** A JSON value: its type, then the input that type takes (none for null). */
export function TypedValueInput({ value, type, disabled, onChange }: Props) {
  const error = value === '' && type === 'number' ? null : typedValueError(value, type);
  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-xs text-fg-muted">
        <span>Type</span>
        <select
          aria-label="Type"
          value={type}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value as EditableConfigType;
            onChange(
              next === 'boolean' && value !== 'false' ? 'true' : next === 'null' ? '' : value,
              next,
            );
          }}
          className={select}
        >
          {EDITABLE_CONFIG_TYPES.map((t) => (
            <option key={t} value={t}>
              {LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      {type === 'string' && (
        <textarea
          aria-label="Value"
          value={value}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value, type)}
          rows={3}
          className={textarea}
        />
      )}
      {type === 'number' && (
        <Input
          aria-label="Value"
          value={value}
          disabled={disabled}
          inputMode="decimal"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value, type)}
          className="h-8 font-mono text-sm"
        />
      )}
      {type === 'boolean' && (
        <select
          aria-label="Value"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value, type)}
          className={select}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      )}
      {error && <span className="block text-xs text-err">{error}</span>}
    </div>
  );
}
