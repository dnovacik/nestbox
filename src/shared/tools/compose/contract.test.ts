import { describe, expect, it } from 'vitest';
import { composeContract } from './contract';

describe('compose contract', () => {
  const up = composeContract.up.input;
  const stop = composeContract.stop.input;

  it('takes one service, several, or none', () => {
    expect(up.safeParse({}).success).toBe(true);
    expect(up.safeParse({ service: 'db' }).success).toBe(true);
    expect(up.safeParse({ services: ['db', 'redis'], wait: true }).success).toBe(true);
    expect(stop.safeParse({ services: ['db'] }).success).toBe(true);
  });

  it('refuses service and services together, bad names and wait on stop', () => {
    expect(up.safeParse({ service: 'db', services: ['redis'] }).success).toBe(false);
    expect(stop.safeParse({ services: ['-v'] }).success).toBe(false);
    expect(stop.safeParse({ wait: true }).success).toBe(false);
  });
});
