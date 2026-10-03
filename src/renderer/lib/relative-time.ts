const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "2 d ago", "4 mo ago", "1 y ago". A time in the future is "just now". */
export function relativeTime(at: number, now: number = Date.now()): string {
  const ms = now - at;
  if (ms < 45_000) return 'just now';
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MIN))} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  if (ms < 30 * DAY) return `${Math.floor(ms / DAY)} d ago`;
  if (ms < 365 * DAY) return `${Math.floor(ms / (30 * DAY))} mo ago`;
  return `${Math.floor(ms / (365 * DAY))} y ago`;
}
