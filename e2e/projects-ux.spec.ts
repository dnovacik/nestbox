import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  const project = await copyFixture('multi-app');
  // The fake Vercel CLI (e2e/fixtures/fake-vercel) answers for the app package's vercel.json.
  ({ app, page } = await launch(project, {
    pathPrepend: join(__dirname, 'fixtures', 'fake-vercel'),
  }));
});

test.afterEach(async () => {
  await app.close();
});

test('a folder with app/ and api/ shows both packages, and the Deploy tab on each', async () => {
  const sidebar = page.getByRole('complementary', { name: 'Projects' });
  await sidebar.getByRole('button', { name: 'Add project' }).click();
  await expect(sidebar.getByRole('button', { name: 'multi-web', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(sidebar.getByRole('button', { name: 'multi-api', exact: true })).toBeVisible();

  await sidebar.getByRole('button', { name: 'multi-web', exact: true }).click();
  await page.getByRole('tab', { name: 'Deploy' }).click();
  await expect(page.getByRole('region', { name: 'Vercel' })).toContainText(
    'Not linked to a Vercel project yet.',
    {
      timeout: 15_000,
    },
  );

  await sidebar.getByRole('button', { name: 'multi-api', exact: true }).click();
  await page.getByRole('tab', { name: 'Deploy' }).click();
  await expect(page.getByRole('region', { name: 'Set up deploys' })).toBeVisible();
});

test('groups: create one, drag a project into it, and rename both inline', async () => {
  const sidebar = page.getByRole('complementary', { name: 'Projects' });
  await sidebar.getByRole('button', { name: 'Add project' }).click();
  await expect(sidebar.getByRole('button', { name: 'multi-web', exact: true })).toBeVisible({
    timeout: 15_000,
  });

  await sidebar.getByRole('button', { name: 'New project group' }).click();
  const groupName = sidebar.getByRole('textbox', { name: 'Project group name' });
  await expect(groupName).toBeFocused();
  await groupName.fill('Work');
  await groupName.press('Enter');
  const work = sidebar.getByRole('region', { name: 'Work' });
  await expect(work).toBeVisible();

  const root = sidebar
    .getByRole('region', { name: 'Other projects' })
    .getByRole('listitem')
    .first();
  await root.dragTo(work.getByText('Drag projects here'));
  await expect(work.getByRole('button', { name: 'multi-web', exact: true })).toBeVisible();

  const rootRow = work.getByRole('listitem').first().getByRole('button').first();
  await rootRow.dblclick();
  const name = sidebar.getByRole('textbox', { name: 'Project name' });
  await expect(name).toBeFocused();
  await name.fill('Multi');
  await name.press('Enter');
  await expect(work.getByRole('button', { name: 'Multi', exact: true })).toBeVisible();
});

test('renaming from the row menu keeps the field focused while typing', async () => {
  const sidebar = page.getByRole('complementary', { name: 'Projects' });
  await sidebar.getByRole('button', { name: 'Add project' }).click();
  const row = sidebar.getByRole('button', { name: 'multi-api', exact: true });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await sidebar.getByRole('button', { name: /^Actions for nestbox-e2e-multi-app/ }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const name = sidebar.getByRole('textbox', { name: 'Project name' });
  await expect(name).toBeFocused();
  // Like a person: after the menu has closed, one key at a time.
  await page.waitForTimeout(400);
  await name.pressSequentially('Backend', { delay: 30 });
  await expect(name).toBeFocused();
  await name.press('Enter');
  await expect(sidebar.getByRole('button', { name: 'Backend', exact: true })).toBeVisible();

  // A group from its menu, too.
  await sidebar.getByRole('button', { name: 'New project group' }).click();
  await sidebar.getByRole('textbox', { name: 'Project group name' }).press('Enter');
  await sidebar.getByRole('button', { name: 'Actions for group New group' }).click();
  await page.getByRole('menuitem', { name: 'Rename group' }).click();
  const group = sidebar.getByRole('textbox', { name: 'Project group name' });
  await page.waitForTimeout(400);
  await group.press('Control+a');
  await group.pressSequentially('Clients', { delay: 30 });
  await expect(group).toBeFocused();
  await group.press('Enter');
  await expect(sidebar.getByRole('region', { name: 'Clients' })).toBeVisible();
});
