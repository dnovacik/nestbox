import { describe, expect, it } from 'vitest';
import { makeDetectedForTest } from '../../test-fixtures';
import { deployContract, deployDefinition } from './contract';

describe('deploy contract', () => {
  const deploy = deployContract.deploy.input;

  it('deploys a preview without a confirmation', () => {
    expect(deploy.safeParse({ platform: 'vercel', target: 'preview' }).success).toBe(true);
  });

  it('refuses a production deploy that was not confirmed', () => {
    expect(deploy.safeParse({ platform: 'fly', target: 'production' }).success).toBe(false);
    expect(
      deploy.safeParse({ platform: 'fly', target: 'production', confirmed: false }).success,
    ).toBe(false);
    expect(
      deploy.safeParse({ platform: 'fly', target: 'production', confirmed: true }).success,
    ).toBe(true);
  });

  it('refuses unknown platforms and extra fields', () => {
    expect(deploy.safeParse({ platform: 'heroku', target: 'preview' }).success).toBe(false);
    expect(
      deploy.safeParse({ platform: 'vercel', target: 'preview', args: ['--yes'] }).success,
    ).toBe(false);
  });

  it('applies to every package, and to a folder with only a deployment config', () => {
    expect(deployDefinition.appliesTo(makeDetectedForTest())).toBe(true);
    expect(deployDefinition.appliesTo(makeDetectedForTest({ packageJson: null }))).toBe(false);
    expect(
      deployDefinition.appliesTo(makeDetectedForTest({ packageJson: null, deploy: ['fly'] })),
    ).toBe(true);
  });
});
