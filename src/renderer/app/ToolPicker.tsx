import { TOGGLEABLE_TOOLS } from '@shared/tools';
import { Switch } from '@/components/ui/switch';
import { toolIcon } from '@/tools/icons';

/** A switch per tool that can be turned off (the core is always on). `disabled` holds the ids that are off. */
export function ToolPicker({
  disabled,
  onChange,
  readOnly = false,
}: {
  disabled: readonly string[];
  onChange(disabled: string[]): void;
  readOnly?: boolean;
}) {
  return (
    <ul aria-label="Tools" className="grid grid-cols-2 gap-x-6 gap-y-2">
      {TOGGLEABLE_TOOLS.map((tool) => {
        const Icon = toolIcon(tool.icon);
        const on = !disabled.includes(tool.id);
        return (
          <li key={tool.id} className="flex items-center gap-2 text-sm">
            <Icon className="size-4 text-fg-muted" aria-hidden />
            <label htmlFor={`tool-toggle-${tool.id}`} className="flex-1 text-fg">
              {tool.name}
            </label>
            <Switch
              id={`tool-toggle-${tool.id}`}
              checked={on}
              disabled={readOnly}
              onCheckedChange={(checked) =>
                onChange(checked ? disabled.filter((id) => id !== tool.id) : [...disabled, tool.id])
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
