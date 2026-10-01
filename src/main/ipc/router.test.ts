import { describe, expect, it, vi } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { ProjectSummary } from '@shared/detected';
import { createMemoryLogger } from '../logger';
import { type CoreHandlers, createRouter } from './router';

const TRUSTED = 'http://localhost:5173/';

function handlers(overrides: Partial<CoreHandlers> = {}): CoreHandlers {
  const unexpected = vi.fn(async () => {
    throw new Error('not expected in this test');
  });
  return {
    'app:getInfo': async () => ({ version: '0.0.0', platform: 'win32' }),
    'dialog:pickFolder': unexpected,
    'projects:list': async () => [],
    'projects:add': unexpected,
    'projects:remove': unexpected,
    'projects:rename': unexpected,
    'projects:setPinned': unexpected,
    'projects:refresh': unexpected,
    'projects:openInEditor': unexpected,
    'projects:openTerminal': unexpected,
    'tools:list': unexpected,
    'tools:invoke': unexpected,
    ...overrides,
  } as CoreHandlers;
}

function router(overrides: Partial<CoreHandlers> = {}) {
  const logger = createMemoryLogger();
  const dispatch = createRouter({
    handlers: handlers(overrides),
    isTrustedSender: (url) => url === TRUSTED,
    logger,
    now: () => 0,
  });
  return { dispatch, logger };
}

describe('router', () => {
  it('dispatches a valid call and wraps the result', async () => {
    const { dispatch } = router();
    expect(await dispatch('app:getInfo', TRUSTED, undefined)).toEqual({
      ok: true,
      data: { version: '0.0.0', platform: 'win32' },
    });
  });

  it('rejects untrusted senders before anything else', async () => {
    const { dispatch } = router();
    expect(await dispatch('projects:list', 'https://evil.example/', undefined)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('rejects unknown channels', async () => {
    const { dispatch } = router();
    expect(await dispatch('projects:nuke', TRUSTED, undefined)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('rejects invalid input without echoing values', async () => {
    const setPinned = vi.fn();
    const { dispatch, logger } = router({ 'projects:setPinned': setPinned });
    const res = await dispatch('projects:setPinned', TRUSTED, { id: 'a', pinned: 'SUPER_SECRET' });
    expect(res).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(JSON.stringify(res)).not.toContain('SUPER_SECRET');
    expect(JSON.stringify(logger.entries)).not.toContain('SUPER_SECRET');
    expect(setPinned).not.toHaveBeenCalled();
  });

  it('rejects extra input keys', async () => {
    const { dispatch } = router();
    expect(await dispatch('projects:list', TRUSTED, { sneaky: true })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('passes parsed (trimmed) input to the handler', async () => {
    const rename = vi.fn(async () => summary());
    const { dispatch } = router({ 'projects:rename': rename });
    await dispatch('projects:rename', TRUSTED, { id: 'a', name: '  New  ' });
    expect(rename).toHaveBeenCalledWith({ id: 'a', name: 'New' });
  });

  it('maps NestboxError to its code and message', async () => {
    const { dispatch } = router({
      'projects:add': async () => {
        throw new NestboxError('CONFLICT', 'This folder is already added as "shop"');
      },
    });
    expect(await dispatch('projects:add', TRUSTED, { path: 'C:\\x' })).toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: 'This folder is already added as "shop"' },
    });
  });

  it('hides unexpected error messages', async () => {
    const { dispatch, logger } = router({
      'projects:list': async () => {
        throw new Error('boom DATABASE_URL=postgres://secret');
      },
    });
    const res = await dispatch('projects:list', TRUSTED, undefined);
    expect(res).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Unexpected error' } });
    expect(JSON.stringify(logger.entries)).not.toContain('secret');
  });

  it('rejects handler output that does not match the schema', async () => {
    const { dispatch } = router({ 'app:getInfo': async () => ({ version: 1 }) as never });
    expect(await dispatch('app:getInfo', TRUSTED, undefined)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    });
  });

  it('logs channel, duration and code only', async () => {
    const { dispatch, logger } = router();
    await dispatch('projects:list', TRUSTED, undefined);
    expect(logger.entries).toEqual([
      { level: 'info', message: 'ipc', fields: { channel: 'projects:list', ms: 0, code: 'OK' } },
    ]);
  });
});

function summary(): ProjectSummary {
  return {
    id: 'a', name: 'New', path: 'C:\\a', pinned: false, tags: [],
    detected: {
      id: 'a', rootId: 'a', path: 'C:\\a', relPath: '', name: 'New', missing: false, packageJson: null,
      packageManager: null, envFiles: [], workspaces: [], prismaSchema: null, dockerCompose: null,
      git: null, buildOutput: null,
      claude: { claudeMd: false, claudeLocalMd: false, claudeDir: false, mcpJson: false },
    },
  };
}
