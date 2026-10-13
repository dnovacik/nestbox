import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeInfo } from './fixtures';
import { installState } from './install-state';

const OLD = new Date('2026-01-01T00:00:00Z');
const NEW = new Date('2026-06-01T00:00:00Z');

async function folder(files: Record<string, Date | null>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nestbox-install-'));
  for (const [name, time] of Object.entries(files)) {
    const path = join(dir, name);
    if (name.endsWith('/')) await mkdir(path, { recursive: true });
    else {
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, '');
    }
    if (time) await utimes(path, time, time);
  }
  return dir;
}

describe('installState', () => {
  it('is missing without node_modules when package.json has dependencies', async () => {
    const dir = await folder({ 'package-lock.json': OLD });
    expect(
      await installState(
        dir,
        null,
        nodeInfo({ lockfiles: ['package-lock.json'], hasDependencies: true }),
      ),
    ).toBe('missing');
  });

  it('is nothing to install without dependencies', async () => {
    const dir = await folder({});
    expect(await installState(dir, null, nodeInfo({ hasDependencies: false }))).toBeNull();
  });

  it.each([
    ['npm', 'package-lock.json', 'node_modules/.package-lock.json'],
    ['pnpm', 'pnpm-lock.yaml', 'node_modules/.modules.yaml'],
    ['yarn', 'yarn.lock', 'node_modules/.yarn-integrity'],
    ['yarn', 'yarn.lock', '.yarn/install-state.gz'],
  ] as const)(
    '%s: stale when %s is newer than %s, else ok',
    async (packageManager, lockfile, marker) => {
      const info = nodeInfo({ packageManager, lockfiles: [lockfile], hasDependencies: true });
      const stale = await folder({ 'node_modules/': OLD, [marker]: OLD, [lockfile]: NEW });
      expect(await installState(stale, null, info)).toBe('stale');
      const fresh = await folder({ 'node_modules/': OLD, [marker]: NEW, [lockfile]: OLD });
      expect(await installState(fresh, null, info)).toBe('ok');
    },
  );

  it('bun: compares the lockfile with the node_modules folder itself', async () => {
    const info = nodeInfo({
      packageManager: 'bun',
      lockfiles: ['bun.lock'],
      hasDependencies: true,
    });
    expect(
      await installState(await folder({ 'node_modules/': OLD, 'bun.lock': NEW }), null, info),
    ).toBe('stale');
    expect(
      await installState(await folder({ 'node_modules/': NEW, 'bun.lock': OLD }), null, info),
    ).toBe('ok');
  });

  it("Yarn Plug'n'Play counts as installed without node_modules", async () => {
    const info = nodeInfo({
      packageManager: 'yarn',
      lockfiles: ['yarn.lock'],
      hasDependencies: true,
    });
    const dir = await folder({ '.pnp.cjs': NEW, '.yarn/install-state.gz': NEW, 'yarn.lock': OLD });
    expect(await installState(dir, null, info)).toBe('ok');
  });

  it("is ok without a lockfile or a marker to compare (it can't tell)", async () => {
    const info = nodeInfo({ lockfiles: [], hasDependencies: true });
    expect(await installState(await folder({ 'node_modules/': OLD }), null, info)).toBe('ok');
    const marked = nodeInfo({ lockfiles: ['package-lock.json'], hasDependencies: true });
    expect(
      await installState(
        await folder({ 'node_modules/': OLD, 'package-lock.json': NEW }),
        null,
        marked,
      ),
    ).toBe('ok');
  });

  it("a workspace package installs at the root: the root's node_modules and lockfile count", async () => {
    const root = await folder({
      'node_modules/': OLD,
      'node_modules/.modules.yaml': OLD,
      'pnpm-lock.yaml': NEW,
      'packages/api/': OLD,
    });
    const info = nodeInfo({
      packageManager: 'pnpm',
      lockfiles: ['pnpm-lock.yaml'],
      hasDependencies: true,
    });
    expect(await installState(join(root, 'packages', 'api'), root, info)).toBe('stale');
  });
});
