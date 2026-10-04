import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  const project = await copyFixture('deps-app');
  // node_modules can't be committed: install the three packages' manifests by hand.
  for (const [name, version] of [
    ['lodash', '4.17.15'],
    ['ms', '2.1.3'],
    ['semver', '6.3.1'],
  ]) {
    await mkdir(join(project, 'node_modules', name as string), { recursive: true });
    await writeFile(join(project, 'node_modules', name as string, 'package.json'), JSON.stringify({ name, version }));
  }
  // A fake npm (e2e/fixtures/fake-npm) answers outdated and audit with real npm output: no registry needed.
  ({ app, page } = await launch(project, { pathPrepend: join(__dirname, 'fixtures', 'fake-npm') }));
});

test.afterEach(async () => {
  await app.close();
});

test('checks on demand, lists outdated and vulnerable packages, and finds them across projects', async () => {
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();

  const card = page.getByRole('region', { name: 'Dependencies' });
  await expect(card.getByText('Not checked yet.')).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'Check' }).click();
  await expect(card.getByText('2 outdated (1 major) · 1 vulnerable (1 high)')).toBeVisible({ timeout: 30_000 });

  await card.getByRole('button', { name: 'Open Dependencies' }).click();
  const table = page.getByRole('table', { name: 'Dependency list' });
  await expect(table.getByRole('row').nth(1)).toContainText('lodash');
  await expect(table.getByRole('row').nth(2)).toContainText('semver');
  await page.getByRole('button', { name: '2 advisories for lodash' }).click();
  await expect(page.getByRole('list', { name: 'Advisories for lodash' })).toContainText('Command Injection in lodash');

  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Dependencies 1 with high or critical advisories' })
    .click();
  const urgent = page.getByRole('region', { name: 'High or critical advisories' });
  await expect(urgent).toContainText('nestbox-e2e-deps');
  await page.getByRole('textbox', { name: 'Package name' }).fill('semver');
  await expect(page.getByRole('table', { name: 'Projects using semver' })).toContainText('6.3.1→ 7.8.5');
});
