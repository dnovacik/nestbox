import type { CiFailure, CiState } from '@shared/tools/ci/contract';

export const STATE_LABEL: Record<CiState, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Passed',
  failure: 'Failed',
  canceled: 'Canceled',
  skipped: 'Skipped',
  manual: 'Manual',
  unknown: 'Unknown',
};

export const STATE_CLASS: Record<CiState, string> = {
  queued: 'border-line text-fg-muted',
  running: 'border-brand/40 text-brand',
  success: 'border-ok/40 text-ok',
  failure: 'border-err/40 text-err',
  canceled: 'border-line text-fg-faint',
  skipped: 'border-line text-fg-faint',
  manual: 'border-warn/40 text-warn',
  unknown: 'border-line text-fg-faint',
};

export const FAILURE_TEXT: Record<CiFailure, string> = {
  'no-provider': 'No GitHub or GitLab remote.',
  'cli-missing': "The CLI isn't installed.",
  'logged-out': 'The CLI is not logged in.',
  'no-remote': "The CLI couldn't find this repository's remote.",
  failed: "Couldn't reach the CI provider.",
  timeout: 'The CI provider took too long to answer.',
};
