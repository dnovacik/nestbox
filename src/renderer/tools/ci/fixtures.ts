import type { CiJob, CiRun, CiStatus } from '@shared/tools/ci/contract';

export const ciStatus = (patch: Partial<CiStatus> = {}): CiStatus => ({
  provider: 'github',
  cli: 'found',
  install: 'https://cli.github.com',
  loginCommand: 'gh auth login',
  branch: 'main',
  latest: null,
  busy: false,
  ...patch,
});

export const ciRun = (patch: Partial<CiRun> = {}): CiRun => ({
  id: '100',
  title: 'Add the cart',
  workflow: 'CI',
  branch: 'main',
  sha: 'abc1234',
  event: 'push',
  state: 'success',
  createdAt: null,
  updatedAt: null,
  url: 'https://github.com/acme/shop/actions/runs/100',
  ...patch,
});

export const ciJob = (patch: Partial<CiJob> = {}): CiJob => ({
  id: '500',
  name: 'test',
  stage: null,
  state: 'success',
  allowFailure: false,
  failedStep: null,
  startedAt: null,
  finishedAt: null,
  url: null,
  ...patch,
});
