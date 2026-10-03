import { execFileSync, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

const hasGit = spawnSync('git', ['--version']).status === 0;

let app: ElectronApplication | undefined;
let page: Page;

test.beforeEach(async () => {
  test.skip(!hasGit, 'git is not installed');
  const project = await copyFixture('npm-app');
  // The user's signing and hooks never apply: this commit must work on any machine.
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=', ...args], {
      cwd: project,
      stdio: 'pipe',
    });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'E2E Tester');
  git('config', 'user.email', 'e2e@example.com');
  git('add', '.');
  git('commit', '-q', '-m', 'chore: fixture app');
  await writeFile(join(project, 'server.js'), '// changed\n', { flag: 'a' });
  ({ app, page } = await launch(project));
});

test.afterEach(async () => {
  await app?.close();
});

test('shows the branch, the changes and the last commit, and lists the changed file', async () => {
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();

  const card = page.getByRole('region', { name: 'Git' });
  await expect(card.getByText('main', { exact: true })).toBeVisible();
  await expect(card.getByText('1 change', { exact: true })).toBeVisible();
  await expect(card.getByText('No upstream')).toBeVisible();
  await expect(card.getByText('chore: fixture app')).toBeVisible();

  await card.getByRole('button', { name: 'Open Git' }).click();
  await expect(page.getByRole('heading', { name: /^Changes/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open server.js' })).toBeVisible();
});
