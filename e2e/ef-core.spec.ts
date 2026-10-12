import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let api = '';

test.beforeEach(async () => {
  const project = await copyFixture('dotnet-app');
  api = join(project, 'src', 'Shop.Api');
  ({ app, page } = await launch(project, {
    pathPrepend: join(__dirname, 'fixtures', 'fake-dotnet'),
  }));
});

test.afterEach(async () => {
  await app.close();
});

test('EF Core in the Database tab: list, add, a confirmed Production update', async () => {
  const sidebar = page.getByRole('complementary', { name: 'Projects' });
  await sidebar.getByRole('button', { name: 'Add project' }).click();
  await sidebar.getByRole('button', { name: 'Shop.Api', exact: true }).click({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Database' }).click();

  const card = page.getByRole('region', { name: 'EF Core', exact: true });
  await expect(card).toContainText('local tool', { timeout: 15_000 });
  await expect(card).toContainText('List migrations to see which are applied.');
  await card.getByRole('button', { name: 'List migrations' }).click();
  const list = card.getByRole('list', { name: 'Migrations' });
  await expect(list.getByRole('listitem', { name: 'AddProducts' })).toContainText('Pending', {
    timeout: 15_000,
  });
  await expect(list.getByRole('listitem', { name: 'Init' })).toContainText('Applied');

  await card.getByRole('button', { name: 'Add migration…' }).click();
  const add = page.getByRole('dialog', { name: 'Add migration' });
  await add.getByRole('textbox', { name: 'Migration name' }).fill('AddOrders');
  await add.getByRole('button', { name: 'Add', exact: true }).click();
  // The list is read again after the add.
  await expect(list.getByRole('listitem', { name: 'AddOrders' })).toContainText('Pending', {
    timeout: 15_000,
  });

  await page
    .getByRole('region', { name: 'Connections' })
    .getByRole('combobox', { name: 'Environment' })
    .selectOption('Production');
  await expect(card).toContainText('List migrations to see which are applied.');
  await card.getByRole('button', { name: 'List migrations' }).click();
  await expect(list.getByRole('listitem', { name: 'AddOrders' })).toContainText('Pending', {
    timeout: 15_000,
  });
  await card.getByRole('button', { name: 'Update database' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Production');
  await confirm.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(list.getByRole('listitem', { name: 'AddOrders' })).toContainText('Applied', {
    timeout: 15_000,
  });

  const calls = await readFile(join(api, '.fake-dotnet.log'), 'utf8');
  expect(calls).toContain(
    'ef migrations add AddOrders --project Shop.Api.csproj --prefix-output -- --environment Development',
  );
  expect(calls).toContain(
    'ef database update --project Shop.Api.csproj --prefix-output -- --environment Production',
  );
  expect(calls).not.toContain('--connection');
  await expect(page.getByLabel('EF Core log', { exact: true })).toContainText('Build succeeded.');
});
