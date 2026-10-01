import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let project: string;

test.beforeEach(async () => {
  project = await copyFixture('npm-app');
  // Written here, not in the fixture folder: .env files are gitignored.
  await writeFile(join(project, '.env'), '# local overrides\nDATABASE_URL=postgres://u:s3cr3t@localhost/db\n');
  await writeFile(join(project, '.env.example'), '# documented keys\nDATABASE_URL=\nPORT=3000\n');
  ({ app, page } = await launch(project));
});

test.afterEach(async () => {
  await app.close();
});

test('adds a key missing from .env with the example value, keeping the file comments', async () => {
  await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'Add project' }).click();
  await page.getByRole('tab', { name: 'Env' }).click();

  const table = page.getByRole('table', { name: 'Env files' });
  await expect(table.getByRole('row', { name: /PORT/ })).toContainText('missing in .env');
  await expect(table).not.toContainText('s3cr3t');

  await page.getByRole('button', { name: 'Add PORT to .env' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add PORT to .env' });
  await dialog.getByRole('button', { name: 'Copy from .env.example' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Value' })).toHaveValue('3000');
  await dialog.getByRole('button', { name: 'Add' }).click();

  await expect
    .poll(() => readFile(join(project, '.env'), 'utf8'))
    .toBe('# local overrides\nDATABASE_URL=postgres://u:s3cr3t@localhost/db\nPORT=3000\n');
  await expect(table.getByRole('row', { name: /PORT/ })).not.toContainText('missing in .env');
});
