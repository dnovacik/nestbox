// Parsers for `ps` on macOS (run with LC_ALL=C). Pure, so they are tested on captured output.
import type { ProcessInfo } from './adapter';

/** ps's etime, `[[dd-]hh:]mm:ss`, in seconds; null when it isn't one. */
export function parseEtime(text: string): number | null {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(?:(\d+):)?(\d+)$/.exec(text.trim());
  if (!match) return null;
  const [, days, a, b, seconds] = match;
  // With two colons the groups are hh, mm; with one, `a` holds the minutes.
  const hours = b === undefined ? 0 : Number(a ?? 0);
  const minutes = b === undefined ? Number(a ?? 0) : Number(b);
  if (days !== undefined && a === undefined) return null;
  return Number(days ?? 0) * 86_400 + hours * 3600 + minutes * 60 + Number(seconds);
}

/** `ps -axo pid=,ppid=,etime=` → processes with a start time of now − elapsed (accurate to 1 s). */
export function parsePsList(text: string, now: number): ProcessInfo[] {
  const out: ProcessInfo[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s*$/.exec(line);
    const elapsed = match ? parseEtime(match[3] ?? '') : null;
    if (match && elapsed !== null) out.push({ pid: Number(match[1]), parentPid: Number(match[2]), startTime: now - elapsed * 1000 });
  }
  return out;
}

/** `ps -ww -o pid=,command= -p …` → command line by PID. */
export function parsePsCommands(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (match?.[2]) out.set(Number(match[1]), match[2]);
  }
  return out;
}
