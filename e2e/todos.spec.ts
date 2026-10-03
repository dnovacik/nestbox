import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  const project = await copyFixture('todo-app');
  // Ignored build output with a TODO of its own: never reported.
  await mkdir(join(project, 'dist'));
  await writeFile(join(project, 'dist', 'bundle.js'), '// TODO: from the build\n');
  ({ app, page } = await launch(project));
});

test.afterEach(async () => {
  await app.close();
});

test('finds tagged comments, skips ignored files, and lists them by file', async () => {
  await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'Add project' }).click();

  const card = page.getByRole('region', { name: 'TODOs' });
  await expect(card.getByText('4 in 3 files')).toBeVisible();
  await expect(card.getByText('TODO 2')).toBeVisible();

  await card.getByRole('button', { name: 'Open TODOs' }).click();
  const files = page.getByRole('list', { name: 'Files with TODOs' });
  await expect(files.getByRole('list', { name: 'src/index.ts' }).getByRole('button')).toHaveText([/2TODOwire the API client/, /4FIXMEhandle an empty listdan/]);
  await expect(files.getByRole('list', { name: 'scripts/build.py' })).toBeVisible();
  await expect(files.getByRole('list', { name: 'README.md' })).toBeVisible();
  await expect(page.getByText('from the build')).toHaveCount(0);
});
