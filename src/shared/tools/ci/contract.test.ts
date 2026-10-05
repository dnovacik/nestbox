import { describe, expect, it } from 'vitest';
import { makeDetectedForTest } from '../../test-fixtures';
import { ciContract, ciDefinition } from './contract';

describe('ci contract', () => {
  it('takes only digit ids, which reach a command line', () => {
    const jobLog = ciContract.jobLog.input;
    expect(jobLog.safeParse({ runId: '123', jobId: '456' }).success).toBe(true);
    expect(jobLog.safeParse({ runId: '12 3', jobId: '456' }).success).toBe(false);
    expect(jobLog.safeParse({ runId: '123', jobId: '4&calc' }).success).toBe(false);
    expect(ciContract.rerunFailed.input.safeParse({ runId: '' }).success).toBe(false);
  });

  it('lists the branch or everything, nothing else', () => {
    expect(ciContract.runs.input.safeParse({ scope: 'branch' }).success).toBe(true);
    expect(ciContract.runs.input.safeParse({ scope: 'main' }).success).toBe(false);
  });

  it('applies to folders with their own repository', () => {
    expect(
      ciDefinition.appliesTo(makeDetectedForTest({ git: { branch: 'main', head: null } })),
    ).toBe(true);
    expect(ciDefinition.appliesTo(makeDetectedForTest({ git: null }))).toBe(false);
  });
});
