import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectProvider, hostOf, providerFor, remoteHost } from './remote';

describe('hostOf', () => {
  it('reads the host of every remote URL form, and keeps nothing else', () => {
    expect(hostOf('git@github.com:acme/shop.git')).toBe('github.com');
    expect(hostOf('https://github.com/acme/shop.git')).toBe('github.com');
    expect(hostOf('https://user:ghp_secret@github.com/acme/shop')).toBe('github.com');
    expect(hostOf('ssh://git@gitlab.example.com:2222/team/app.git')).toBe('gitlab.example.com');
    expect(hostOf('GitLab.com:team/app.git')).toBe('gitlab.com');
    expect(hostOf('/srv/repos/app.git')).toBeNull();
    expect(hostOf('file:///srv/repos/app.git')).toBeNull();
  });
});

describe('remoteHost', () => {
  it("prefers origin's URL", () => {
    const config = [
      '[core]',
      '\tbare = false',
      '[remote "upstream"]',
      '\turl = https://gitlab.com/team/app.git',
      '[remote "origin"]',
      '\turl = git@github.com:me/app.git',
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
    ].join('\n');
    expect(remoteHost(config)).toBe('github.com');
  });

  it('falls back to the first remote, and to null without one', () => {
    expect(remoteHost('[remote "fork"]\n  url = https://gitlab.com/a/b\n')).toBe('gitlab.com');
    expect(remoteHost('[core]\n\tbare = false\n')).toBeNull();
  });
});

describe('providerFor', () => {
  const none = { githubWorkflows: false, gitlabCi: false };

  it('knows GitHub and GitLab hosts', () => {
    expect(providerFor('github.com', none)).toBe('github');
    expect(providerFor('acme.ghe.com', none)).toBe('github');
    expect(providerFor('gitlab.com', none)).toBe('gitlab');
    expect(providerFor('gitlab.acme.dev', none)).toBe('gitlab');
  });

  it('falls back to the CI files for other hosts', () => {
    expect(providerFor('git.acme.dev', { githubWorkflows: true, gitlabCi: false })).toBe('github');
    expect(providerFor(null, { githubWorkflows: false, gitlabCi: true })).toBe('gitlab');
    expect(providerFor('git.acme.dev', none)).toBeNull();
  });
});

describe('detectProvider', () => {
  let dir: string;
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the repository's config", async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestbox-ci-'));
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, '.git', 'config'), '[remote "origin"]\n\turl = https://gitlab.com/t/a\n');
    expect(await detectProvider(dir)).toBe('gitlab');
  });

  it('uses the workflow folder when the remote says nothing', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestbox-ci-'));
    await mkdir(join(dir, '.git'));
    await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
    expect(await detectProvider(dir)).toBe('github');
  });

  it('is null outside a repository', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestbox-ci-'));
    expect(await detectProvider(dir)).toBeNull();
  });
});
