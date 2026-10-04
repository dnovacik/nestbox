import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  // .nvmrc asks for Node 1, which is never the Node running the tests.
  ({ app, page } = await launch(await copyFixture('node-app')));
});

test.afterEach(async () => {
  await app.close();
});

test('flags a Node mismatch on the card and the tab, and warns when a script starts', async () => {
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();

  const card = page.getByRole('region', { name: 'Node' });
  await expect(card.getByText("Versions don't match")).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText(/Needs 1 \(\.nvmrc\)/)).toBeVisible();

  await card.getByRole('button', { name: 'Open Node' }).click();
  const sources = page.getByRole('list', { name: 'Sources' });
  await expect(sources.getByRole('listitem').first()).toContainText('.nvmrc1used');
  await expect(sources.getByRole('listitem').nth(1)).toContainText('engines.node>=1');

  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'Start dev' }).click();
  await expect(page.getByLabel(/^Version warning: Node v\d+\.\d+\.\d+ doesn't match 1 \(\.nvmrc\)$/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('log', { name: 'dev output' })).toContainText("▲ Node v", { timeout: 15_000 });
  await page.getByRole('button', { name: 'Stop dev' }).click();
});
