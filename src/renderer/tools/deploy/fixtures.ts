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
  environments: ['production', 'preview', 'development'],
  ...patch,
});

export const deployStatus = (
  platforms: PlatformStatus[],
  patch: Partial<DeployStatus> = {},
): DeployStatus => ({
  platforms,
  action: null,
  last: null,
  envFiles: ['.env', '.env.production'],
  defaultEnvFile: '.env.production',
  scripts: ['build', 'dev', 'test'],
  ready: null,
  ...patch,
});

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
