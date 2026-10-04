import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogSnapshot } from '@shared/processes';
import { makeDetectedForTest } from '@shared/test-fixtures';
import type { ComposeStatus } from '@shared/tools/compose/contract';
import { createMemoryLogger } from '../../logger';
import { type FakeChild, fakePlatform } from '../../processes/fake-child';
import { createSharedContext } from '../shared-context';
import type { AnyMainTool, ToolContext } from '../types';
import { createComposeTool } from './index';

type SpawnArgs = { cwd: string; command: string; args: string[] };

let tool: AnyMainTool | null = null;
afterEach(async () => {
  await tool?.dispose?.();
  tool = null;
});

const PS = [
  {
    Service: 'db',
    State: 'running',
    Health: 'healthy',
    ExitCode: 0,
    Labels: 'PASSWORD=hunter2',
    Publishers: [{ URL: '0.0.0.0', TargetPort: 5432, PublishedPort: 5432, Protocol: 'tcp' }],
  },
  {
    Service: 'web',
    State: 'exited',
    Health: '',
    ExitCode: 1,
    Command: 'node --secret=hunter2',
    Publishers: [],
  },
];

interface Answers {
  config?: { code: number | null; stdout?: string; stderr?: string };
  ps?: { code: number | null; stdout?: string; stderr?: string };
}

/** A fake platform whose docker answers config and ps at once; actions and logs stay open for the test. */
function setup(answers: Answers = {}, opts: { dockerExists?: boolean | null } = {}) {
  const base = fakePlatform();
  const platform = { ...base, commandExists: vi.fn(async () => opts.dockerExists ?? true) };
  const config = answers.config ?? { code: 0, stdout: 'db\nweb\ncache\n' };
  const ps = answers.ps ?? { code: 0, stdout: PS.map((c) => JSON.stringify(c)).join('\n') };
  // Rebuild spawnCommand: answer config/ps, leave the rest to the test.
  const spawnCommand = vi.fn((o: SpawnArgs) => {
    const child = fakePlatform().spawnCommand();
    const fake = child as unknown as FakeChild;
    base.children.push(fake);
    const sub = o.args[3];
    const answer = sub === 'config' ? config : sub === 'ps' ? ps : null;
    if (answer) {
      queueMicrotask(() => {
        if (answer.stdout) fake.stdout.write(answer.stdout);
        if (answer.stderr) fake.stderr.write(answer.stderr);
        fake.exit(answer.code);
      });
    }
    return child;
  });
  const p = { ...platform, spawnCommand };
  const logger = createMemoryLogger();
  tool = createComposeTool({ logger });
  const emit = vi.fn();
  const ctx = {
    project: makeDetectedForTest({ path: '/work/shop', dockerCompose: 'compose.yaml' }),
    shared: createSharedContext().forProject('p1'),
    emit,
    platform: p,
    settings: { get: () => ({}), update: (fn: (s: object) => object) => fn({}) },
  } as unknown as ToolContext;
  const call = <T>(method: string, input: unknown = {}) =>
    tool?.handlers[method]?.(ctx, input) as Promise<T>;
  const calls = () => (spawnCommand.mock.calls as [SpawnArgs][]).map(([o]) => o.args.slice(3));
  const lastChild = () => base.children.at(-1) as FakeChild;
  return { call, emit, platform: p, logger, calls, lastChild };
}

describe('compose tool: status', () => {
  it('lists every service with its state, health, exit code and ports, and nothing else', async () => {
    const { call, calls } = setup();
    const status = await call<ComposeStatus>('status');
    expect(status).toEqual({
      state: 'ok',
      file: 'compose.yaml',
      action: null,
      following: null,
      services: [
        {
          name: 'db',
          state: 'running',
          health: 'healthy',
          exitCode: 0,
          ports: [{ published: 5432, target: 5432, protocol: 'tcp' }],
        },
        { name: 'web', state: 'exited', health: null, exitCode: 1, ports: [] },
        { name: 'cache', state: 'not-created', health: null, exitCode: null, ports: [] },
      ],
    });
    expect(JSON.stringify(status)).not.toMatch(/hunter2/);
    expect(calls()).toEqual([
      ['config', '--services'],
      ['ps', '--all', '--format', 'json'],
    ]);
  });

  it('caches the status for a second', async () => {
    const { call, calls } = setup();
    await call('status');
    await call('status');
    expect(calls()).toHaveLength(2);
  });

  it('says when docker is missing, not running, or cannot read the file', async () => {
    expect(await setup({}, { dockerExists: false }).call('status')).toEqual({
      state: 'docker-missing',
      file: 'compose.yaml',
    });
    const down = setup({
      ps: {
        code: 1,
        stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock.',
      },
    });
    expect(await down.call('status')).toEqual({ state: 'daemon-down', file: 'compose.yaml' });
    const invalid = setup({
      config: { code: 15, stderr: 'yaml: line 3: secret=hunter2 did not find expected key' },
    });
    expect(await invalid.call('status')).toEqual({ state: 'invalid', file: 'compose.yaml' });
    expect(JSON.stringify(invalid.logger.entries)).not.toMatch(/hunter2|yaml/);
  });
});

describe('compose tool: actions and logs', () => {
  it('runs an action for a known service and refuses unknown ones', async () => {
    const { call, calls, lastChild, emit } = setup();
    const result = call('stop', { service: 'web' });
    await vi.waitFor(() => expect(calls().at(-1)).toEqual(['stop', 'web']));
    lastChild().exit(0);
    expect(await result).toEqual({ ok: true, code: 0 });
    expect(emit).toHaveBeenCalledWith('changed', undefined);
    await expect(call('restart', { service: 'nope' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('runs down for the whole stack, without -v', async () => {
    const { call, calls, lastChild } = setup();
    const result = call('down');
    await vi.waitFor(() => expect(calls().at(-1)).toEqual(['down']));
    lastChild().exit(0);
    await result;
  });

  it('shows the running action and the followed service in the status', async () => {
    const { call, calls, lastChild } = setup();
    await call('follow', { service: 'db' });
    expect(calls().at(-1)).toEqual([
      'logs',
      '-f',
      '--no-color',
      '--no-log-prefix',
      '--tail',
      '500',
      'db',
    ]);
    const logChild = lastChild();
    logChild.stdout.write('ready\n');
    const up = call('up', {});
    await vi.waitFor(() => expect(calls().at(-1)).toEqual(['up', '-d']));
    const upChild = lastChild();
    const status = await call<ComposeStatus>('status');
    expect(status).toMatchObject({ action: { name: 'up', service: null }, following: 'db' });
    await vi.waitFor(async () =>
      expect(
        (await call<LogSnapshot>('getLogs', { source: 'service' })).lines.map((l) => l.text),
      ).toEqual(['ready']),
    );
    upChild.exit(0);
    await up;
    await call('unfollow');
    expect((await call<ComposeStatus>('status')).state === 'ok').toBe(true);
    await call('clearLogs', { source: 'actions' });
    expect((await call<LogSnapshot>('getLogs', { source: 'actions' })).lines).toEqual([]);
  });

  it('applies only to packages with a compose file', async () => {
    setup();
    expect(tool?.appliesTo(makeDetectedForTest({ dockerCompose: null }))).toBe(false);
    expect(tool?.appliesTo(makeDetectedForTest({ dockerCompose: 'docker-compose.yml' }))).toBe(
      true,
    );
  });
});
