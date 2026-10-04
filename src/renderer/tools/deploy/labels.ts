import type { DeployState, ListingFailure } from '@shared/tools/deploy/contract';

export const STATE_LABEL: Record<DeployState, string> = {
  ready: 'Ready',
  building: 'Building',
  queued: 'Queued',
  error: 'Failed',
  canceled: 'Canceled',
  unknown: 'Unknown',
};

export const STATE_CLASS: Record<DeployState, string> = {
  ready: 'border-ok/40 text-ok',
  building: 'border-brand/40 text-brand',
  queued: 'border-line text-fg-muted',
  error: 'border-err/40 text-err',
  canceled: 'border-line text-fg-faint',
  unknown: 'border-line text-fg-faint',
};

export const LISTING_TEXT: Record<ListingFailure, string> = {
  'cli-missing': "The CLI isn't installed.",
  'not-linked': 'Not linked yet.',
  'logged-out': 'The CLI is not logged in.',
  failed: "Couldn't list deployments.",
  timeout: 'Listing deployments timed out.',
};
