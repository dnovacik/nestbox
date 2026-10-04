import { describe, expect, it } from 'vitest';
import { composeStepMessage } from './compose-steps';

describe('composeStepMessage', () => {
  it('says nothing for ok and names the package otherwise', () => {
    expect(composeStepMessage({ relPath: '', result: 'ok' })).toBeNull();
    expect(composeStepMessage({ relPath: '', result: 'failed' })).toBe(
      "Compose in the root didn't start its services: see its Compose tab",
    );
    expect(composeStepMessage({ relPath: 'packages/api', result: 'busy' })).toMatch(
      /^Compose in packages\/api was busy/,
    );
    expect(composeStepMessage({ relPath: 'infra', result: 'missing' })).toMatch(/no compose file/);
  });
});
