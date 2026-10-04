import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let project: string;

test.beforeEach(async () => {
  project = await copyFixture('deploy-app');
  // A fake Vercel CLI (e2e/fixtures/fake-vercel) lists deployments and "deploys" without any network.
  ({ app, page } = await launch(project, {
    pathPrepend: join(__dirname, 'fixtures', 'fake-vercel'),
  }));
});

test.afterEach(async () => {
  await app.close();
});

test('lists Vercel deployments, deploys a preview, and asks before production', async () => {
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();

  const card = page.getByRole('region', { name: 'Deploy' });
  await expect(card.getByText('shop', { exact: true })).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'Open Deploy' }).click();

  const table = page.getByRole('table', { name: 'Vercel deployments' });
  await expect(table.getByRole('row').nth(1)).toContainText('Building', { timeout: 15_000 });
  await expect(table.getByRole('row').nth(1)).toContainText('feature/cart');
  await expect(table.getByRole('row').nth(2)).toContainText('production');

  await page.getByRole('button', { name: 'Deploy preview' }).click();
  await expect(page.getByText('Preview: https://shop-git-e2e-acme.vercel.app [3s]')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Open the last deploy' })).toBeVisible();

  await page.getByRole('button', { name: 'Deploy to production…' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Deploy nestbox-e2e-deploy to production on Vercel?');
  await dialog.getByRole('button', { name: 'Deploy to production' }).click();
  await expect(page.getByText('Production: https://shop-acme.vercel.app [3s]')).toBeVisible({
    timeout: 15_000,
  });

  const calls = (await readFile(join(project, '.fake-vercel.log'), 'utf8')).trim().split(/\r?\n/);
  expect(calls.filter((c) => c.startsWith('deploy'))).toEqual([
    'deploy --non-interactive',
    'deploy --non-interactive --prod',
  ]);
});

test('compares the local env file with Vercel production, by key name', async () => {
  // Env files are gitignored, so the test writes its own (before adding the project).
  await writeFile(
    join(project, '.env.production'),
    'DATABASE_URL=postgres://local\nLOCAL_ONLY=1\n',
  );
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();
  await page
    .getByRole('region', { name: 'Deploy' })
    .getByRole('button', { name: 'Open Deploy' })
    .click({ timeout: 15_000 });

  const env = page.getByRole('group', { name: 'Vercel env' });
  await expect(env.getByRole('combobox', { name: 'Local env file' })).toHaveText('.env.production');
  await env.getByRole('button', { name: 'Compare' }).click();
  await expect(env.getByRole('list', { name: 'Missing on Vercel' })).toHaveText('LOCAL_ONLY', {
    timeout: 15_000,
  });
  await expect(env.getByRole('list', { name: 'Only on Vercel' })).toHaveText('STRIPE_SECRET');
  await expect(env).not.toContainText('postgres');
});
