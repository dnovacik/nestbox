import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let project: string;

test.beforeEach(async () => {
  project = await copyFixture('npm-app');
  // A repository on main with a GitHub origin: written by hand, so the test needs no git.
  await mkdir(join(project, '.git'));
  await writeFile(join(project, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  await writeFile(
    join(project, '.git', 'config'),
    '[remote "origin"]\n\turl = git@github.com:acme/shop.git\n',
  );
  // The fake GitHub CLI (e2e/fixtures/fake-gh) answers the runs, jobs, log and re-run.
  ({ app, page } = await launch(project, { pathPrepend: join(__dirname, 'fixtures', 'fake-gh') }));
});

test.afterEach(async () => {
  await app.close();
});

test("lists the branch's runs, tails a failed job's log, and re-runs the failed jobs", async () => {
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();
  await page.getByRole('tab', { name: 'CI', exact: true }).click();

  const runs = page.getByRole('list', { name: 'Runs' });
  await expect(
    runs.getByRole('button', { name: 'Run Fix the cart totals', exact: true }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(runs.getByRole('listitem')).toHaveCount(2);

  const detail = page.getByRole('region', { name: 'Run details' });
  await expect(detail.getByText('· Run pnpm test')).toBeVisible();
  await detail.getByRole('button', { name: 'Show log of test' }).click();
  await expect(page.getByLabel('Log of test', { exact: true })).toContainText(
    'AssertionError: expected 108 to be 110',
  );

  await detail.getByRole('button', { name: 'Re-run failed jobs' }).click();
  await expect(page.getByText('Re-running 1 failed job')).toBeVisible();

  const calls = (await readFile(join(project, '.fake-gh.log'), 'utf8')).trim().split('\n');
  expect(calls).toContain(
    'run list --limit 15 --json databaseId,status,conclusion,workflowName,displayTitle,headBranch,headSha,event,createdAt,updatedAt,url --branch main',
  );
  expect(calls).toContain('run view --job 72 --log-failed');
  expect(calls).toContain('run rerun 9001 --failed');

  // The overview card shows the newest run the tab has seen, without listing again.
  await page.getByRole('tab', { name: 'Overview' }).click();
  const card = page.getByRole('region', { name: 'CI', exact: true });
  await expect(card).toContainText('Failed');
  await expect(card).toContainText('Fix the cart totals');
});
