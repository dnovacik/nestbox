import type { AggregateState } from '@shared/processes';
import { cn } from '@/lib/utils';

const COLOURS: Record<AggregateState, string> = {
  running: 'bg-ok',
  starting: 'bg-warn',
  crashed: 'bg-err',
  idle: 'bg-idle',
};

/** A flat status dot. Decorative: callers describe the state in text or a title. */
export function StateDot({ state, className }: { state: AggregateState; className?: string }) {
  return <span aria-hidden data-state={state} className={cn('size-2 shrink-0 rounded-full', COLOURS[state], className)} />;
}
