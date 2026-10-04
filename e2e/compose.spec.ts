import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let project: string;

/** The fake docker's container states, kept in the project folder. */
const fakeState = (): Record<string, string> => {
  try {
    return JSON.parse(readFileSync(join(project, '.fake-docker.json'), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
};

test.beforeEach(async () => {
  project = await copyFixture('compose-app');
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

test('a run group brings a compose service up before its script, and stops both', async () => {
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'New group' }).click();
  const dialog = page.getByRole('dialog', { name: 'New run group' });
  await dialog.getByRole('textbox', { name: 'Group name' }).fill('stack');
  await dialog.getByRole('group', { name: 'Root' }).getByRole('checkbox', { name: 'dev' }).check();
  const compose = dialog.getByRole('group', { name: 'Compose: Root' });
  await compose.getByRole('checkbox', { name: 'Start compose services' }).check();
  await compose.getByRole('radio', { name: 'Some services' }).check({ timeout: 15_000 });
  await compose.getByRole('checkbox', { name: 'db' }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();

  const groups = page.getByRole('region', { name: 'Run groups' });
  await expect(groups.getByText('dev · compose: db')).toBeVisible();
  await groups.getByRole('button', { name: 'Start group stack' }).click();
  await expect(page.getByRole('button', { name: 'Stop dev' })).toBeVisible({ timeout: 30_000 });
  // Only the group's service came up.
  expect(fakeState()).toEqual({ db: 'running' });

  await groups.getByRole('button', { name: 'Stop group stack' }).click();
  await expect(page.getByRole('button', { name: 'Start dev' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(fakeState, { timeout: 15_000 }).toEqual({ db: 'exited' });
});
