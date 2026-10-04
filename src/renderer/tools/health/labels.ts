import type { CheckResult, CheckView } from '@shared/tools/health/contract';

export type Tone = 'ok' | 'err' | 'warn' | 'idle';

/** Green ok, red fail, amber config, grey idle or not run yet. */
export function checkTone(result: CheckResult | null): Tone {
  if (!result) return 'idle';
  return result.state === 'ok'
    ? 'ok'
    : result.state === 'fail'
      ? 'err'
      : result.state === 'config'
        ? 'warn'
        : 'idle';
}

export const DOT_CLASS: Record<Tone, string> = {
  ok: 'bg-ok',
  err: 'bg-err',
  warn: 'bg-warn',
  idle: 'bg-fg-faint',
};

export const TONE_LABEL: Record<Tone, string> = {
  ok: 'Healthy',
  err: 'Failing',
  warn: 'Needs setup',
  idle: 'Not checked',
};

/** "200 · 12 ms", "ECONNREFUSED", "not set in .env". */
export function resultText(check: CheckView): string {
  const r = check.result;
  if (!r) return 'Not checked yet';
  const parts: string[] = [];
  if (r.status !== null) parts.push(String(r.status));
  if (r.ms !== null) parts.push(`${r.ms} ms`);
  if (r.reason && !(r.status !== null && r.reason === `status ${r.status}`)) parts.push(r.reason);
  return parts.join(' · ') || r.state;
}

export const INTERVALS = [5, 10, 15, 30, 60, 120, 300, 600] as const;

export function intervalLabel(sec: number): string {
  return sec < 60 ? `${sec} s` : sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`;
}
