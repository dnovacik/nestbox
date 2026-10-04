import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  const project = await copyFixture('npm-app');
  ({ app, page } = await launch(project, { firstRun: true }));
});

test.afterEach(async () => {
  await app.close();
});

test('a new install picks its tools, and Settings turns one back on', async () => {
  const welcome = page.getByRole('dialog', { name: 'Welcome to NestBox' });
  await expect(welcome).toBeVisible({ timeout: 15_000 });
  await welcome.getByRole('button', { name: 'Essentials' }).click();
  await welcome.getByRole('button', { name: 'Start with these tools' }).click();
  await expect(welcome).toBeHidden();

  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();
  const tabs = page.getByRole('tablist', { name: 'Project tools' });
  await expect(tabs.getByRole('tab', { name: 'Scripts' })).toBeVisible({ timeout: 15_000 });
  await expect(tabs.getByRole('tab', { name: 'Env', exact: true })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Static' })).toHaveCount(0);
  await expect(tabs.getByRole('tab', { name: 'TODOs' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('switch', { name: 'Static' }).click();
  await settings.getByRole('switch', { name: 'Env' }).click();
  await settings.getByRole('button', { name: 'Save' }).click();
  await expect(settings).toBeHidden();
  await expect(tabs.getByRole('tab', { name: 'Static' })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Env', exact: true })).toHaveCount(0);
});
