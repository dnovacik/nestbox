import { readFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { addProjectAndOpenScripts, copyFixture, launch } from './helpers';

// Ports are listed with netstat on Windows and lsof on macOS; Linux (a dev sandbox) has neither wired up.
test.skip(platform() === 'linux', 'Windows and macOS only');

let app: ElectronApplication;
let page: Page;
let project: string;

test.beforeEach(async () => {
  project = await copyFixture('npm-app');
  ({ app, page } = await launch(project));
});

test.afterEach(async () => {
  await app.close();
});

test('lists a script port with its owner and frees it by stopping the script', async () => {
  test.setTimeout(120_000);
  await addProjectAndOpenScripts(page);
  await page.getByRole('button', { name: 'Start web' }).click();
  await expect(page.getByRole('log', { name: 'web output' })).toContainText('listening on port', { timeout: 30_000 });
  const port = Number((await readFile(join(project, 'web.port'), 'utf8')).trim());

  await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'Ports' }).click();
  const table = page.getByRole('table', { name: 'Listening ports' });
  const row = table.getByRole('row').filter({ has: page.getByRole('cell', { name: String(port), exact: true }) });
  // The owner needs the process tree (PowerShell on Windows), which can be slow on a cold runner.
  await expect(row.getByRole('button', { name: 'nestbox-e2e-app · web' })).toBeVisible({ timeout: 60_000 });

  // A NestBox port: no confirm, the script is stopped.
  await row.getByRole('button', { name: `Kill port ${port}` }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(row).toHaveCount(0, { timeout: 20_000 });

  await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'nestbox-e2e-app', exact: true }).click();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await expect(page.getByRole('button', { name: 'Start web' })).toBeVisible();
});
