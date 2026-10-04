import type { ServicePort, ServiceView } from '@shared/tools/compose/contract';

export type Tone = 'ok' | 'warn' | 'err' | 'idle';

/** Green running, amber starting/unhealthy/restarting/paused, red exited with an error, grey otherwise. */
export function serviceTone(s: ServiceView): Tone {
  if (s.state === 'running')
    return s.health === 'unhealthy' || s.health === 'starting' ? 'warn' : 'ok';
  if (s.state === 'restarting' || s.state === 'paused') return 'warn';
  if (s.state === 'dead' || (s.state === 'exited' && s.exitCode !== null && s.exitCode !== 0))
    return 'err';
  return 'idle';
}

export const DOT_CLASS: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  err: 'bg-err',
  idle: 'bg-fg-faint',
};

/** "running · healthy", "exited (1)", "not created". */
export function stateText(s: ServiceView): string {
  if (s.state === 'not-created') return 'not created';
  const base = s.state === 'exited' && s.exitCode !== null ? `exited (${s.exitCode})` : s.state;
  return s.health ? `${base} · ${s.health}` : base;
}

export const isUp = (s: ServiceView) => s.state === 'running' || s.state === 'restarting';

export function runningCount(services: readonly ServiceView[]): number {
  return services.filter(isUp).length;
}

/** Likely an HTTP port: worth an "Open" link. */
export function opensInBrowser(p: ServicePort): boolean {
  return (
    p.protocol === 'tcp' &&
    (p.target === 80 || p.target === 443 || (p.target >= 3000 && p.target <= 9999))
  );
}

export const PROBLEM_TEXT = {
  'docker-missing': "Docker isn't installed.",
  'daemon-down': "Docker isn't running: start Docker Desktop.",
  invalid: "docker compose can't read the compose file.",
} as const;
