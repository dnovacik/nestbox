import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let api: string;

test.beforeEach(async () => {
  const project = await copyFixture('dotnet-app');
  api = join(project, 'src', 'Shop.Api');
  ({ app, page } = await launch(project, { pathPrepend: join(__dirname, 'fixtures', 'fake-dotnet') }));
});

test.afterEach(async () => {
  await app.close();
});

test('appsettings in the Env tab: matrix, profiles, reveal, typed edits that keep comments, raw edits, new files', async () => {
  const sidebar = page.getByRole('complementary', { name: 'Projects' });
  await sidebar.getByRole('button', { name: 'Add project' }).click();
  await sidebar.getByRole('button', { name: 'Shop.Api', exact: true }).click({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Env' }).click();

  const section = page.getByRole('region', { name: 'Configuration' });
  const table = section.getByRole('table', { name: 'Settings files' });
  await expect(table.getByRole('row', { name: /Logging:LogLevel:Default/ })).toContainText('overridden');
  await expect(table).not.toContainText('s3cr3t');
  await expect(page.getByText('No .env files in this folder.')).toHaveCount(0);
  const profiles = section.getByRole('list', { name: 'Launch profiles' });
  await expect(profiles).toContainText('http → Development');

  await table.getByRole('button', { name: 'Reveal ConnectionStrings:Shop in appsettings.json' }).click();
  await expect(table.getByText('Host=localhost;Password=s3cr3t')).toBeVisible();
  await table.getByRole('button', { name: 'Hide ConnectionStrings:Shop in appsettings.json' }).click();
  await expect(table).not.toContainText('s3cr3t');

  // A typed edit: the comment and the rest of the file survive.
  await table.getByRole('button', { name: 'Edit AllowedHosts in appsettings.json' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit AllowedHosts in appsettings.json' });
  await expect(edit.getByRole('textbox', { name: 'Value' })).toHaveValue('*');
  await edit.getByRole('textbox', { name: 'Value' }).fill('localhost');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect
    .poll(() => readFile(join(api, 'appsettings.json'), 'utf8'))
    .toContain('"AllowedHosts": "localhost"');
  const text = await readFile(join(api, 'appsettings.json'), 'utf8');
  expect(text).toContain('// Shared by every environment');
  expect(text).toContain('"Microsoft.AspNetCore": "Warning"');

  // A new number key.
  await section.getByRole('button', { name: 'Add key' }).click();
  const add = page.getByRole('dialog', { name: 'Add key' });
  await add.getByRole('combobox', { name: 'Key' }).fill('Kestrel:Limits:MaxRequests');
  await add.getByRole('combobox', { name: 'Type' }).selectOption('number');
  await add.getByRole('textbox', { name: 'Value' }).fill('100');
  await add.getByRole('button', { name: 'Add' }).click();
  await expect(table.getByRole('row', { name: /Kestrel:Limits:MaxRequests/ })).toBeVisible();
  expect(await readFile(join(api, 'appsettings.json'), 'utf8')).toMatch(/"MaxRequests": 100\n/);

  // A raw edit that doesn't parse is refused and the file stays as it was.
  const before = await readFile(join(api, 'appsettings.Development.json'), 'utf8');
  await section.getByRole('button', { name: 'Edit as text' }).click();
  await page.getByRole('menuitem', { name: 'appsettings.Development.json' }).click();
  const raw = page.getByRole('dialog', { name: 'Edit appsettings.Development.json' });
  await raw.getByRole('textbox', { name: 'File contents' }).fill('{ "Logging": ');
  await raw.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('The settings file is not valid JSON')).toBeVisible();
  expect(await readFile(join(api, 'appsettings.Development.json'), 'utf8')).toBe(before);
  await raw.getByRole('button', { name: 'Cancel' }).click();

  // The prod profile runs as Production, which has no file until it is created.
  await expect(profiles).toContainText('prod → Production');
  await profiles.getByRole('button', { name: 'Create appsettings.Production.json' }).click();
  await expect(table.getByRole('columnheader', { name: 'appsettings.Production.json' })).toBeVisible();
  expect(await readFile(join(api, 'appsettings.Production.json'), 'utf8')).toBe('{}\n');
  await expect(profiles.getByRole('button', { name: /^Create / })).toHaveCount(0);
});
