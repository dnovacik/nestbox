import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let server: Server;

test.beforeEach(async () => {
  const project = await copyFixture('dotnet-app');
  // A local TCP server stands in for the development database: the reachability check only connects.
  server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await writeFile(
    join(project, 'src', 'Shop.Api', 'appsettings.Development.json'),
    JSON.stringify({ ConnectionStrings: { Shop: `Host=127.0.0.1;Port=${port};Database=shop_dev;Username=dev;Password=s3cr3t` } }, null, 2),
  );
  ({ app, page } = await launch(project, { pathPrepend: join(__dirname, 'fixtures', 'fake-dotnet') }));
});

test.afterEach(async () => {
  await app.close();
  await new Promise((resolve) => server.close(resolve));
});

test('ConnectionStrings in the Database tab: per environment, described and checked, no secrets', async () => {
  const sidebar = page.getByRole('complementary', { name: 'Projects' });
  await sidebar.getByRole('button', { name: 'Add project' }).click();
  await sidebar.getByRole('button', { name: 'Shop.Api', exact: true }).click({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Database' }).click();

  const card = page.getByRole('region', { name: 'Connections' });
  const shop = card.getByRole('listitem', { name: 'Shop' });
  await expect(card.getByRole('combobox', { name: 'Environment' })).toHaveValue('Development');
  await expect(shop).toContainText('postgresql · 127.0.0.1:', { timeout: 15_000 });
  await expect(shop).toContainText('/shop_dev');
  await expect(shop).toContainText('appsettings.Development.json');
  await expect(shop).toContainText('Reachable');

  await card.getByRole('combobox', { name: 'Environment' }).selectOption('Production');
  await expect(shop).toContainText('postgresql · 127.0.0.1:1/shop');
  await expect(shop).toContainText('appsettings.json');
  await expect(shop).toContainText('Refused', { timeout: 10_000 });

  // No DATABASE_URL card in a .NET package without Prisma, and no secret anywhere.
  await expect(page.getByRole('region', { name: 'Connection', exact: true })).toHaveCount(0);
  const text = (await page.locator('body').textContent()) ?? '';
  expect(text).not.toContain('s3cr3t');
  expect(text).not.toContain('Username');
});
