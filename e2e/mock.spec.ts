import { createServer } from 'node:net';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;

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
  ({ app, page } = await launch(await copyFixture('npm-app')));
});

test.afterEach(async () => {
  await app.close();
});

test('serves a route, fails it on demand, and logs the requests', async () => {
  const port = await freePort();
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();
  await page.getByRole('tab', { name: 'Mock API' }).click();
  const panel = page.getByRole('region', { name: 'Mock API' });

  const portField = panel.getByRole('textbox', { name: 'Port' });
  await portField.fill(String(port));
  await portField.press('Enter');

  await panel.getByRole('button', { name: 'Add route' }).click();
  const form = page.getByRole('form', { name: 'Route' });
  await form.getByRole('textbox', { name: 'Path' }).fill('/users/:id');
  await form.getByRole('textbox', { name: 'Body' }).fill('{"id": "{{params.id}}", "name": "Ada"}');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByRole('list', { name: 'Routes' }).getByRole('listitem')).toHaveCount(1);

  await panel.getByRole('button', { name: 'Start' }).click();
  await expect(panel.getByText(`http://localhost:${port}`, { exact: true })).toBeVisible();

  const ok = await fetch(`http://127.0.0.1:${port}/users/42?token=abc`);
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ id: '42', name: 'Ada' });
  expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);

  await panel.getByRole('switch', { name: 'Fail GET /users/:id' }).click();
  await expect.poll(async () => (await fetch(`http://127.0.0.1:${port}/users/1`)).status).toBe(500);

  const log = panel.getByRole('log');
  await expect(log).toContainText('GET /users/42 → 200');
  await expect(log).toContainText('GET /nope → 404');
  await expect(log).not.toContainText('token');

  await panel.getByRole('button', { name: 'Stop' }).click();
  await expect(panel.getByText('Stopped', { exact: true })).toBeVisible();
});
