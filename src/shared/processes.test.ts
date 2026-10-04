import { describe, expect, it } from 'vitest';
import { aggregateState, belongsTo, isLive, ProcessSummarySchema } from './processes';

describe('process helpers', () => {
  it.each([
    [[], 'idle'],
    [['running', 'stopped'], 'running'],
    [['running', 'stopping'], 'starting'],
    [['starting', 'crashed'], 'crashed'],
    [['exited'], 'idle'],
  ] as const)('aggregates %j to %s', (states, expected) => {
    expect(aggregateState(states)).toBe(expected);
  });

  it('matches a project and its workspaces only', () => {
    expect(belongsTo('r1::packages/api', 'r1')).toBe(true);
    expect(belongsTo('r1', 'r1')).toBe(true);
    expect(belongsTo('r10', 'r1')).toBe(false);
    expect(belongsTo('r1', 'r1::packages/api')).toBe(false);
  });

  it('knows which states are live', () => {
    expect(['starting', 'running', 'stopping'].every((s) => isLive(s as never))).toBe(true);
    expect(['stopped', 'exited', 'crashed'].some((s) => isLive(s as never))).toBe(false);
  });

  it('parses a full summary', () => {
    const summary = {
      projectId: 'r1', script: 'dev', state: 'crashed', pid: null, startedAt: 1,
      exit: { code: 1, signal: null, lastLine: 'Error' }, crashCount: 2, autoRestart: true,
      nextRestartAt: 5, gaveUp: false, warning: null,
    };
    expect(ProcessSummarySchema.parse(summary)).toEqual(summary);
  });
});
