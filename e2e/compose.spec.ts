import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  const project = await copyFixture('compose-app');
  // CI runners can't be relied on for Docker: a fake docker (e2e/fixtures/fake-docker) comes first on PATH.
  ({ app, page } = await launch(project, {
    pathPrepend: join(__dirname, 'fixtures', 'fake-docker'),
  }));
});

test.afterEach(async () => {
  await app.close();
});

test('brings the stack up, stops one service and follows its logs', async () => {
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();

  const card = page.getByRole('region', { name: 'Compose' });
  await expect(card.getByText('0 of 2 running')).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'Up all' }).click();
  await expect(card.getByText('2 of 2 running')).toBeVisible({ timeout: 15_000 });

  await card.getByRole('button', { name: 'Open Compose' }).click();
  const panel = page.getByRole('region', { name: 'Compose' });
  const services = panel.getByRole('list', { name: 'Services' });
  await expect(services.getByRole('listitem').first()).toContainText('5432→5432');
  await expect(panel.getByRole('log')).toContainText('Container fixture-db-1  Started');

  await services.getByRole('button', { name: 'Stop web' }).click();
  await expect(services.getByRole('button', { name: 'Start web' })).toBeVisible({
    timeout: 15_000,
  });

  await services.getByRole('button', { name: 'Logs of db' }).click();
  await expect(panel.getByRole('log')).toContainText('db ready to accept connections', {
    timeout: 15_000,
  });
});
