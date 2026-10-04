import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let project: string;

test.beforeEach(async () => {
  project = await copyFixture('deploy-app');
  // A fake Vercel CLI (e2e/fixtures/fake-vercel) lists deployments and "deploys" without any network.
  ({ app, page } = await launch(project, { pathPrepend: join(__dirname, 'fixtures', 'fake-vercel') }));
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
  await expect(page.getByText('Production: https://shop-acme.vercel.app [3s]')).toBeVisible({ timeout: 15_000 });

  const calls = (await readFile(join(project, '.fake-vercel.log'), 'utf8')).trim().split(/\r?\n/);
  expect(calls.filter((c) => c.startsWith('deploy'))).toEqual([
    'deploy --non-interactive',
    'deploy --non-interactive --prod',
  ]);
});
