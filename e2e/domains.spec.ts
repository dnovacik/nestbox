import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let userData = '';

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

function get(port: number, host: string): Promise<{ status: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/', headers: { host } }, (res) => {
      res.resume();
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          ...(res.headers.location ? { location: res.headers.location } : {}),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

test.beforeEach(async () => {
  const project = await copyFixture('echo-api');
  await writeFile(join(project, '.env'), `PORT=${await freePort()}\n`);
  ({ app, page, userData } = await launch(project, { fakeTrust: true }));
});

test.afterEach(async () => {
  await app.close();
});

test('routes a running project through its local domain over HTTP and trusted HTTPS', async () => {
  const httpPort = await freePort();
  const httpsPort = await freePort();
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();
  // Ports first (80/443 can't be counted on in CI); the service persists them.
  await page.evaluate(
    ([h, s]) =>
      (
        globalThis as unknown as {
          nestbox: { invoke(channel: string, input: unknown): Promise<unknown> };
        }
      ).nestbox.invoke('domains:setPorts', { httpPort: h, httpsPort: s }),
    [httpPort, httpsPort],
  );
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('switch', { name: 'Local domains' }).click();
  await expect(settings.getByText('Trusted', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'Start serve' }).click();
  await expect(page.getByRole('log', { name: 'serve output' })).toContainText('listening', {
    timeout: 30_000,
  });
  const name = 'nestbox-e2e-echo-api.localhost';
  await expect.poll(async () => (await get(httpPort, name)).status, { timeout: 30_000 }).toBe(308);
  expect((await get(httpPort, name)).location).toBe(`https://${name}:${httpsPort}/`);

  const ca = JSON.parse(await readFile(join(userData, 'domains-ca.json'), 'utf8')) as {
    root: { cert: string };
  };
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpsRequest(
      {
        host: '127.0.0.1',
        port: httpsPort,
        servername: name,
        ca: ca.root.cert,
        headers: { host: name },
        path: '/',
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end();
  });
  expect(status).toBe(200);
  await expect(page.getByRole('link', { name: `https://${name}:${httpsPort}` })).toBeVisible();
});
