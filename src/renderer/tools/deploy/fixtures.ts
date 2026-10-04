import type { Deployment, DeployStatus, PlatformStatus } from '@shared/tools/deploy/contract';

export const platformStatus = (patch: Partial<PlatformStatus> = {}): PlatformStatus => ({
  platform: 'vercel',
  cli: 'global',
  install: 'npm i -g vercel',
  linked: true,
  name: 'shop',
  flavour: null,
  dashboardUrl: 'https://vercel.com/acme/shop',
  preview: true,
  production: true,
  hint: null,
  canLink: false,
  ...patch,
});

export const deployStatus = (
  platforms: PlatformStatus[],
  patch: Partial<DeployStatus> = {},
): DeployStatus => ({ platforms, action: null, last: null, ...patch });

export const deployment = (patch: Partial<Deployment> = {}): Deployment => ({
  id: 'dpl_1',
  state: 'ready',
  environment: 'production',
  branch: 'main',
  label: null,
  createdAt: null,
  url: 'https://shop.vercel.app',
  logsUrl: 'https://vercel.com/acme/shop/1',
  ...patch,
});
