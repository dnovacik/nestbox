import type { CheckResult, CheckView, HealthStatus } from '@shared/tools/health/contract';

export const checkResult = (
  state: CheckResult['state'],
  patch: Partial<CheckResult> = {},
): CheckResult => ({
  state,
  status: state === 'ok' ? 200 : null,
  ms: state === 'ok' ? 12 : null,
  reason: state === 'fail' ? 'ECONNREFUSED' : state === 'config' ? 'not set in .env' : null,
  at: Date.now() - 10_000,
  ...patch,
});

export const checkView = (
  id: string,
  label: string,
  result: CheckResult | null = null,
  patch: Partial<CheckView> = {},
): CheckView => ({
  id,
  kind: 'url',
  label,
  expect: null,
  result,
  ...patch,
});

/** A package's health status, for renderer tests. */
export function healthStatus(patch: Partial<HealthStatus> = {}): HealthStatus {
  return {
    live: false,
    intervalSec: 30,
    notify: true,
    checks: [],
    suggestions: { port: null, envKeys: [] },
    ...patch,
  };
}
