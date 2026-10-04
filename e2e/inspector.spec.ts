import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;
let apiPort = 0;

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
  const project = await copyFixture('echo-api');
  apiPort = await freePort();
  await writeFile(join(project, '.env'), `PORT=${apiPort}\n`);
  ({ app, page } = await launch(project));
});

test.afterEach(async () => {
  await app.close();
});

test('records a proxied request with its token masked, and replays it', async () => {
  const inspectorPort = await freePort();
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();
  await page.getByRole('tab', { name: 'Scripts' }).click();
  await page.getByRole('button', { name: 'Start serve' }).click();
  await expect(page.getByRole('log', { name: 'serve output' })).toContainText('listening on port', {
    timeout: 30_000,
  });

  await page.getByRole('tab', { name: 'Inspector' }).click();
  const panel = page.getByRole('region', { name: 'Inspector' });
  await expect(panel.getByRole('textbox', { name: 'API address' })).toHaveAttribute(
    'placeholder',
    `http://localhost:${apiPort} (PORT from .env)`,
  );
  const port = panel.getByRole('textbox', { name: 'Port' });
  await port.fill(String(inspectorPort));
  await port.press('Enter');
  await panel.getByRole('button', { name: 'Start' }).click();
  await expect(panel.getByText(`http://localhost:${inspectorPort}`)).toBeVisible();

  const res = await fetch(`http://127.0.0.1:${inspectorPort}/orders?page=2`, {
    method: 'POST',
    headers: { Authorization: 'Bearer s3cr3t' },
    body: 'hello',
  });
  expect(await res.json()).toEqual({ method: 'POST', url: '/orders?page=2', body: 'hello' });

  const list = panel.getByRole('list', { name: 'Requests' });
  await list.getByRole('button', { name: /\/orders\?page=2/ }).click();
  const detail = panel.getByRole('region', { name: 'Request detail' });
  await expect(detail.getByLabel('Body')).toContainText('"url": "/orders?page=2"');
  await detail.getByRole('button', { name: 'Request', exact: true }).click();
  const headers = detail.getByRole('table', { name: 'Request headers' });
  await expect(headers).toContainText('••••••');
  await expect(headers).not.toContainText('s3cr3t');

  await detail.getByRole('button', { name: 'Replay' }).click();
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(list.getByRole('button').first()).toContainText('replay');
});
