import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  ({ app, page } = await launch(await copyFixture('npm-app')));
});

test.afterEach(async () => {
  await app.close();
});

const background = () =>
  page
    .locator('body')
    .evaluate((body) => (body as any).ownerDocument.defaultView?.getComputedStyle(body).backgroundColor);

async function pickTheme(name: 'Light' | 'Dark' | 'System') {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('combobox', { name: 'Theme', exact: true }).click();
  await page.getByRole('option', { name }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
}

test('switches between the light and dark themes live, and the window follows', async () => {
  await pickTheme('Light');
  await expect.poll(background).toBe('rgb(255, 255, 255)');
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');

  await pickTheme('Dark');
  await expect.poll(background).toBe('rgb(13, 17, 23)');
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors)).toBe(true);
});
