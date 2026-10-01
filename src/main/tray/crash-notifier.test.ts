import { describe, expect, it } from 'vitest';
import type { ProcessSummary } from '@shared/processes';
import { crashNotice } from './crash-notifier';

const crashed = (over: Partial<ProcessSummary>): ProcessSummary => ({
  projectId: 'p1', script: 'api', state: 'crashed', pid: null, startedAt: 1,
  exit: { code: 1, signal: null, lastLine: 'DATABASE_URL=postgres://secret' },
  crashCount: 1, autoRestart: false, nextRestartAt: null, gaveUp: false, ...over,
});

describe('crashNotice', () => {
  it('names the script, project and exit code', () => {
    expect(crashNotice(crashed({}), 'shop')).toEqual({ title: 'NestBox', body: 'api crashed in shop (exit 1)' });
  });

  it('reports signals, failed starts and giving up', () => {
    expect(crashNotice(crashed({ exit: { code: null, signal: 'SIGTERM', lastLine: null } }), 'shop').body).toBe(
      'api crashed in shop (killed by SIGTERM)',
    );
    expect(crashNotice(crashed({ exit: { code: null, signal: null, lastLine: null } }), 'shop').body).toBe(
      'api crashed in shop (could not start)',
    );
    expect(crashNotice(crashed({ gaveUp: true, crashCount: 5 }), 'shop · api').body).toBe(
      'api crashed in shop · api and gave up after 5 crashes',
    );
  });

  it('never includes the last output line', () => {
    expect(JSON.stringify(crashNotice(crashed({}), 'shop'))).not.toContain('secret');
  });
});
