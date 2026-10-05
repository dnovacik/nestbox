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

/** "Add project" on the fixture folder (app/ + api/, no package.json of its own) asks about a group. */
async function addFolder(answer: 'group' | 'no', groupName?: string) {
  const sidebar = page.getByRole('complementary', { name: 'Projects' });
  await sidebar.getByRole('button', { name: 'Add project' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add under a group?' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText('multi-web')).toBeVisible();
  if (answer === 'no') {
    await dialog.getByRole('button', { name: 'No, add without a group' }).click();
  } else {
    const name = dialog.getByRole('textbox', { name: 'Group name' });
    await expect(name).toHaveValue(/^nestbox-e2e-multi-app/);
    if (groupName) await name.fill(groupName);
    await dialog.getByRole('button', { name: 'Add under group' }).click();
  }
  await expect(dialog).toHaveCount(0);
  return sidebar;
}

test('"No" adds app/ and api/ as separate projects, each with the Deploy tab', async () => {
  const sidebar = await addFolder('no');
  const other = sidebar.getByRole('region', { name: 'All projects' });
  await expect(other.getByRole('button', { name: 'multi-web', exact: true })).toBeVisible();
  await expect(other.getByRole('button', { name: 'multi-api', exact: true })).toBeVisible();
  // No row for the folder itself.
  await expect(sidebar.getByRole('button', { name: /^nestbox-e2e-multi-app/ })).toHaveCount(0);

  await sidebar.getByRole('button', { name: 'multi-web', exact: true }).click();
  await page.getByRole('tab', { name: 'Deploy' }).click();
  await expect(page.getByRole('region', { name: 'Vercel' })).toContainText(
    'Not linked to a Vercel project yet.',
    { timeout: 15_000 },
  );

  await sidebar.getByRole('button', { name: 'multi-api', exact: true }).click();
  await page.getByRole('tab', { name: 'Deploy' }).click();
  await expect(page.getByRole('region', { name: 'Set up deploys' })).toBeVisible();
});

test('a group from the dialog holds both projects; rename them by double-click', async () => {
  const sidebar = await addFolder('group', 'Work');
  const work = sidebar.getByRole('region', { name: 'Work' });
  await expect(work.getByRole('button', { name: 'multi-web', exact: true })).toBeVisible();
  await expect(work.getByRole('button', { name: 'multi-api', exact: true })).toBeVisible();

  // Drag one out to the ungrouped list's own group, then back.
  await sidebar.getByRole('button', { name: 'New project group' }).click();
  const groupName = sidebar.getByRole('textbox', { name: 'Project group name' });
  await expect(groupName).toBeFocused();
  await groupName.fill('Later');
  await groupName.press('Enter');
  const later = sidebar.getByRole('region', { name: 'Later' });
  await work
    .getByRole('listitem')
    .filter({ hasText: 'multi-api' })
    .dragTo(later.getByText('Drag projects here'));
  await expect(later.getByRole('button', { name: 'multi-api', exact: true })).toBeVisible();

  await work.getByRole('button', { name: 'multi-web', exact: true }).dblclick();
  const name = sidebar.getByRole('textbox', { name: 'Project name' });
  await expect(name).toBeFocused();
  await name.fill('Web');
  await name.press('Enter');
  await expect(work.getByRole('button', { name: 'Web', exact: true })).toBeVisible();
});

test('renaming from the row menu keeps the field focused while typing', async () => {
  const sidebar = await addFolder('no');
  await expect(sidebar.getByRole('button', { name: 'multi-api', exact: true })).toBeVisible();

  await sidebar.getByRole('button', { name: 'Actions for multi-api' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const name = sidebar.getByRole('textbox', { name: 'Project name' });
  await expect(name).toBeFocused();
  // Like a person: after the menu has closed, one key at a time.
  await page.waitForTimeout(400);
  await name.press('ControlOrMeta+a');
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
  await group.press('ControlOrMeta+a');
  await group.pressSequentially('Clients', { delay: 30 });
  await expect(group).toBeFocused();
  await group.press('Enter');
  await expect(sidebar.getByRole('region', { name: 'Clients' })).toBeVisible();
});
