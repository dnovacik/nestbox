import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  const project = await copyFixture('npm-app');
  // Written here, not in the fixture: dist/ is gitignored, and other tests expect no build output.
  await mkdir(join(project, 'dist', 'assets'), { recursive: true });
  await writeFile(join(project, 'dist', 'index.html'), '<!doctype html><title>Fixture app</title><script src="/assets/app.js"></script>\n');
  await writeFile(join(project, 'dist', 'assets', 'app.js'), 'console.log("fixture");\n');
  await writeFile(join(project, 'dist', '.secret'), 'never served\n');
  ({ app, page } = await launch(project));
});

test.afterEach(async () => {
  await app.close();
});

test('serves the build output with SPA fallback, logs requests and stops', async () => {
  await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'Add project' }).click();
  await page.getByRole('tab', { name: 'Static' }).click();
  await page.getByRole('button', { name: 'Start' }).click();

  const link = page.getByRole('link', { name: /^http:\/\/localhost:\d+\/$/ });
  const url = (await link.textContent())?.replace('localhost', '127.0.0.1') ?? '';
  expect(await (await fetch(url)).text()).toContain('Fixture app');
  const deep = await fetch(`${url}deep/route?token=abc`);
  expect(deep.status).toBe(200);
  expect(await deep.text()).toContain('Fixture app');
  expect((await fetch(`${url}.secret`)).status).toBe(404);

  const log = page.getByRole('log', { name: 'Requests output' });
  await expect(log).toContainText('GET /deep/route');
  await expect(log).toContainText('404 GET /.secret');
  await expect(log).not.toContainText('token');

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect(fetch(url)).rejects.toThrow();
});
