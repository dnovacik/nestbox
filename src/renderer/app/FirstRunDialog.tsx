import { useState } from 'react';
import { ESSENTIAL_TOOLS, TOGGLEABLE_TOOLS } from '@shared/tools';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSettings, useUpdateSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { ToolPicker } from './ToolPicker';

const ALL = TOGGLEABLE_TOOLS.map((t) => t.id);
const PRESETS: { label: string; disabled: string[] }[] = [
  { label: 'Everything', disabled: [] },
  { label: 'Essentials', disabled: ALL.filter((id) => !ESSENTIAL_TOOLS.includes(id)) },
  { label: 'Just the core', disabled: ALL },
];

/** A new install picks its tools once; it can't be dismissed without choosing. Settings → Tools changes them later. */
export function FirstRunDialog() {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const [disabled, setDisabled] = useState<string[]>([]);
  const open = settings !== undefined && !settings.toolsChosen && !settings.readOnly;
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((id) => b.includes(id));
  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-xl"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Welcome to NestBox</DialogTitle>
          <DialogDescription>
            Pick the tools you want. Projects, scripts and ports are always there; you can change
            the rest any time in Settings → Tools.
          </DialogDescription>
        </DialogHeader>
        <div role="group" aria-label="Presets" className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button
              key={p.label}
              type="button"
              variant="secondary"
              size="sm"
              aria-pressed={same(disabled, p.disabled)}
              className={cn(same(disabled, p.disabled) && 'border border-brand/50')}
              onClick={() => setDisabled(p.disabled)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <ToolPicker disabled={disabled} onChange={setDisabled} />
        <DialogFooter>
          <Button
            type="button"
            disabled={update.isPending}
            onClick={() => update.mutate({ disabledTools: disabled, toolsChosen: true })}
          >
            Start with these tools
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
