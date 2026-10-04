import { describe, expect, it, vi } from 'vitest';
import { fakePlatform } from '../../processes/fake-child';
import { createRun } from './run';

describe('createRun', () => {
  it('collects stdout with the shell env and colours off, whatever the exit code', async () => {
    const platform = fakePlatform();
    const run = createRun(platform, '/work/demo');
    const result = run('npm', ['outdated', '--json']);
    await vi.waitFor(() => expect(platform.children).toHaveLength(1));
    const child = platform.last();
    child.stdout.write('{"lodash":');
    child.stdout.write('{}}');
    child.stderr.write('npm WARN something');
    child.exit(1);
    expect(await result).toEqual({ code: 1, stdout: '{"lodash":{}}', timedOut: false });
    expect(platform.spawnCommand).toHaveBeenCalledWith({
      cwd: '/work/demo',
      command: 'npm',
      args: ['outdated', '--json'],
      env: expect.objectContaining({ PATH: 'x', NO_COLOR: '1', FORCE_COLOR: '0' }),
    });
  });

  it('kills a command that runs past the timeout', async () => {
    const platform = fakePlatform();
    const result = await createRun(platform, '/work/demo', 20)('pnpm', ['audit', '--json']);
    expect(result).toEqual({ code: null, stdout: '', timedOut: true });
    expect(platform.killTree).toHaveBeenCalled();
  });

  it('reports a command that cannot start', async () => {
    const platform = fakePlatform();
    platform.spawnCommand.mockImplementationOnce(() => {
      throw new Error('ENOENT');
    });
    expect(await createRun(platform, '/w')('bun', ['audit'])).toEqual({
      code: null,
      stdout: '',
      timedOut: false,
    });
  });
});
