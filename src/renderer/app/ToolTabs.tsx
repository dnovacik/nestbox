import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
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
  const tabs: ToolSummary[] = [
    { id: OVERVIEW_TAB, name: 'Overview', icon: 'layout-grid' },
    ...tools,
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = tabs.findIndex((t) => t.id === active);
  const barRef = useRef<HTMLDivElement | null>(null);
  // Which ends have tabs cut off: an arrow shows on that side.
  const [hidden, setHidden] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const left = bar.scrollLeft > 1;
    const right = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1;
    setHidden((h) => (h.left === left && h.right === right ? h : { left, right }));
  }, []);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [measure, tabs.length]);

  const scrollPage = (direction: -1 | 1) => {
    const bar = barRef.current;
    if (!bar) return;
    bar.scrollBy({ left: direction * Math.max(80, bar.clientWidth * 0.8), behavior: 'smooth' });
  };

  // The bar scrolls when there are more tabs than fit: keep the selected one in view.
  useEffect(() => {
    refs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeIndex]);

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

  const arrow = (direction: -1 | 1) => {
    const Icon = direction < 0 ? ChevronLeft : ChevronRight;
    return (
      <button
        type="button"
        // The tab list already moves with the arrow keys: these are for the mouse.
        tabIndex={-1}
        aria-label={direction < 0 ? 'Scroll tabs left' : 'Scroll tabs right'}
        onClick={() => scrollPage(direction)}
        className={cn(
          'absolute inset-y-0 z-10 flex w-7 items-center justify-center bg-app text-fg-muted hover:text-fg',
          direction < 0 ? 'left-0 border-r border-line' : 'right-0 border-l border-line',
        )}
      >
        <Icon aria-hidden className="size-4" />
      </button>
    );
  };

  return (
    <div className="relative shrink-0 border-b border-line">
      {hidden.left && arrow(-1)}
      <div
        ref={barRef}
        onScroll={measure}
        role="tablist"
        aria-label="Project tools"
        // More tabs than fit: the bar scrolls sideways (wheel, trackpad, or selecting a tab), with no scrollbar.
        onWheel={(e) => {
          if (e.deltaX === 0 && e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
        }}
        className="flex gap-1 overflow-x-auto overflow-y-hidden px-5 [scrollbar-width:none]"
      >
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
                '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors',
                selected
                  ? 'border-brand text-brand'
                  : 'border-transparent text-fg-muted hover:border-line hover:text-fg',
              )}
            >
              <Icon aria-hidden className="size-3.5" />
              {tab.name}
            </button>
          );
        })}
      </div>
      {hidden.right && arrow(1)}
    </div>
  );
}
