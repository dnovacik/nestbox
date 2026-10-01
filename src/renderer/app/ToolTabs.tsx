import { type KeyboardEvent, useRef } from 'react';
import type { ToolSummary } from '@shared/tool';
import { cn } from '@/lib/utils';
import { toolIcon } from '@/tools/icons';

export const OVERVIEW_TAB = 'overview';

export const tabId = (projectId: string, tab: string): string => `tab-${projectId}-${tab}`;
export const panelId = (projectId: string): string => `panel-${projectId}`;

interface ToolTabsProps {
  projectId: string;
  tools: ToolSummary[];
  active: string;
  onSelect(tab: string): void;
}

/** WAI-ARIA tabs with automatic activation: arrows, Home and End move focus and select. */
export function ToolTabs({ projectId, tools, active, onSelect }: ToolTabsProps) {
  const tabs: ToolSummary[] = [{ id: OVERVIEW_TAB, name: 'Overview', icon: 'layout-grid' }, ...tools];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    const tab = tabs[next];
    if (!tab) return;
    onSelect(tab.id);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label="Project tools" className="flex gap-1 border-b border-line px-5">
      {tabs.map((tab, index) => {
        const Icon = toolIcon(tab.icon);
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            id={tabId(projectId, tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(projectId)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
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
