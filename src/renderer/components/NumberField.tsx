import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

/** A number field saved on blur or Enter; an invalid entry snaps back. */
export function NumberField({
  label,
  value,
  min,
  max,
  nullable,
  placeholder,
  onSave,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  nullable?: boolean;
  placeholder?: string;
  onSave(v: number | null): void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  const commit = () => {
    const trimmed = text.trim();
    const next = trimmed === '' ? (nullable ? null : min) : Number(trimmed);
    if (next !== null && !(Number.isInteger(next) && next >= min && next <= max)) {
      setText(value === null ? '' : String(value));
      return;
    }
    if (next !== value) onSave(next);
  };
  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className="h-7 w-20 font-mono text-xs"
    />
  );
}
