import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let port = 0;

/** A port nothing listens on right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

test.beforeEach(async () => {
  const project = await copyFixture('health-app');
  port = await freePort();
  await writeFile(join(project, '.env'), `PORT=${port}\n`);
  ({ app, page } = await launch(project));
});

test.afterEach(async () => {
  await app.close();
});

test('checks the suggested URL while the script runs', async () => {
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();

  const card = page.getByRole('region', { name: 'Health' });
  await expect(card.getByText('No checks')).toBeVisible();
  await card.getByRole('button', { name: `Add localhost:${port}` }).click();
  await expect(card.getByText(`localhost:${port}/`)).toBeVisible();
  await expect(card.getByText('Idle (no scripts running)')).toBeVisible();

  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'Start serve' }).click();
  await expect(page.getByRole('log', { name: 'serve output' })).toContainText('listening on port', {
    timeout: 30_000,
  });

  await page.getByRole('tab', { name: 'Health' }).click();
  const panel = page.getByRole('region', { name: 'Health' });
  await expect(panel.getByText('Running')).toBeVisible();
  // The first check runs 2 s after the start, which can be before a slow start listens; the next is 30 s away.
  await panel.getByRole('button', { name: 'Check now' }).click();
  const row = panel.getByRole('list', { name: 'Checks' }).getByRole('listitem');
  await expect(row.getByTitle('Healthy')).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('200');

  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'Stop serve' }).click();
  await expect(page.getByRole('button', { name: 'Start serve' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Health' }).click();
  await expect(panel.getByText('Idle (no scripts running)')).toBeVisible();
  await expect(row.getByTitle('Not checked')).toBeVisible();
});
