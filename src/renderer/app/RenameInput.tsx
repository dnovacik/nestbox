import { useState } from 'react';
import { Input } from '@/components/ui/input';

interface RenameInputProps {
  initial: string;
  onSubmit(name: string): void;
  onCancel(): void;
}

export function RenameInput({ initial, onSubmit, onCancel }: RenameInputProps) {
  const [value, setValue] = useState(initial);
  return (
    <Input
      aria-label="Project name"
      autoFocus
      value={value}
      maxLength={100}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const name = value.trim();
          if (name && name !== initial) onSubmit(name);
          else onCancel();
        }
      }}
      className="h-8 max-w-sm text-lg font-bold"
    />
  );
}
