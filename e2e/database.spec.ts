import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let server: Server | null = null;
let port = 0;

test.beforeEach(async () => {
  // Stands in for Postgres: the panel only opens a TCP connection, it never logs in by itself.
  server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  port = typeof address === 'object' && address ? address.port : 0;
  const project = await copyFixture('prisma-app');
  // Written here, not in the fixture folder: .env files are gitignored.
  await writeFile(join(project, '.env'), `DATABASE_URL="postgresql://alice:s3cr3t@127.0.0.1:${port}/shop?schema=public"\n`);
  ({ app, page } = await launch(project));
});

test.afterEach(async () => {
  await app.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

test('shows where DATABASE_URL points without its credentials, and whether the server answers', async () => {
  await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'Add project' }).click();

  const card = page.getByRole('region', { name: 'Database' });
  await expect(card.getByText(`postgresql · 127.0.0.1:${port}/shop`)).toBeVisible();
  await expect(card.getByText('Reachable')).toBeVisible();

  // The server goes away; NestBox notices when its window gets focus again.
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  await page.evaluate('window.dispatchEvent(new Event("focus"))');
  await expect(card.getByText('Refused')).toBeVisible();

  await card.getByRole('button', { name: 'Open Database' }).click();
  const connection = page.getByRole('region', { name: 'Connection' });
  await expect(connection.getByText('DATABASE_URL')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Prisma' }).getByRole('button', { name: 'Start Studio' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('s3cr3t');
  await expect(page.locator('body')).not.toContainText('alice');
});
