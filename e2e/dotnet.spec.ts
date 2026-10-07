import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let project: string;

test.beforeEach(async () => {
  project = await copyFixture('dotnet-app');
  // A fake dotnet (e2e/fixtures/fake-dotnet) answers --list-sdks, run and list package: no SDK or NuGet needed.
  ({ app, page } = await launch(project, { pathPrepend: join(__dirname, 'fixtures', 'fake-dotnet') }));
});

test.afterEach(async () => {
  await app.close();
});

test('a .NET solution: its projects, detected tasks, the SDK warning, hide/restore and a NuGet check', async () => {
  const sidebar = page.getByRole('complementary', { name: 'Projects' });
  await sidebar.getByRole('button', { name: 'Add project' }).click();

  // The solution is one project; its projects are packages, test projects aside.
  await expect(sidebar.getByRole('button', { name: 'Shop.Api', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(sidebar.getByRole('button', { name: 'Shop.Core', exact: true })).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Shop.Tests', exact: true })).toHaveCount(0);

  await sidebar.getByRole('button', { name: 'Shop.Api', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Project info' })).toContainText('.NET · net10.0 · web · SDK 9.0.100', {
    timeout: 15_000,
  });

  await page.getByRole('tab', { name: 'Scripts' }).click();
  const list = page.getByRole('region', { name: 'Scripts' });
  await expect(list.getByText('dotnet run --project Shop.Api.csproj --launch-profile http', { exact: true })).toBeVisible();

  await list.getByRole('button', { name: 'Hide clean' }).click();
  await expect(list.getByRole('button', { name: 'Start clean' })).toHaveCount(0);
  await list.getByRole('button', { name: 'Restore clean' }).click();
  await expect(list.getByRole('button', { name: 'Start clean' })).toBeVisible();

  await list.getByRole('button', { name: 'Start run:http', exact: true }).click();
  await expect(list.getByText('running')).toBeVisible({ timeout: 15_000 });
  await expect(list.getByLabel('Version warning: global.json asks for .NET SDK 9.0.100 (rollForward latestPatch); installed: 8.0.414, 10.0.401')).toHaveText('.NET');
  await expect(page.getByText('Now listening on: http://localhost:5283')).toBeVisible();
  await list.getByRole('button', { name: 'Stop run:http', exact: true }).click();
  await expect(list.getByRole('button', { name: 'Start run:http', exact: true })).toBeVisible({ timeout: 15_000 });
  const calls = await readFile(join(project, 'src', 'Shop.Api', '.fake-dotnet.log'), 'utf8');
  expect(calls).toContain('run --project Shop.Api.csproj --launch-profile http');

  await sidebar.getByRole('button', { name: 'Shop.Core', exact: true }).click();
  const card = page.getByRole('region', { name: 'Dependencies' });
  await expect(card.getByText('Not checked yet.')).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'Check' }).click();
  await expect(card.getByText('1 outdated (1 major) · 1 vulnerable (1 high)')).toBeVisible({ timeout: 30_000 });
});
