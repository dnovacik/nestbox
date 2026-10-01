import type { ToolSummary } from '@shared/tool';
import { cn } from '@/lib/utils';
import { toolIcon } from '@/tools/icons';

export const OVERVIEW_TAB = 'overview';

interface ToolTabsProps {
  tools: ToolSummary[];
  active: string;
  onSelect(tab: string): void;
}

export function ToolTabs({ tools, active, onSelect }: ToolTabsProps) {
  const tabs: ToolSummary[] = [{ id: OVERVIEW_TAB, name: 'Overview', icon: 'layout-grid' }, ...tools];
  return (
    <div role="tablist" aria-label="Project tools" className="flex gap-1 border-b border-line px-5">
      {tabs.map((tab) => {
        const Icon = toolIcon(tab.icon);
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2 text-xs font-medium transition-colors',
              selected ? 'border-brand text-brand' : 'border-transparent text-fg-muted hover:border-line hover:text-fg',
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {tab.name}
          </button>
        );
      })}
    </div>
  );
}
