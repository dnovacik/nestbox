import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  ({ app, page } = await launch(await copyFixture('npm-app')));
});

test.afterEach(async () => {
  await app.close();
});

test('Ctrl+K runs a script and opens its log', async () => {
  await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'Add project' }).click();
  await expect(page.getByRole('heading', { name: 'nestbox-e2e-app' })).toBeVisible();

  // Lower-case k: Playwright adds Shift for 'K', and the shortcut ignores Shift.
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByRole('combobox').fill('run serve');
  await expect(palette.getByRole('option', { name: /Run serve in nestbox-e2e-app/ })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(palette).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Scripts', selected: true })).toBeVisible();
  await expect(page.getByRole('log', { name: 'serve output' })).toContainText('listening', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Stop serve' }).click();
});
