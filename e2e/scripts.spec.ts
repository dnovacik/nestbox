import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { addProjectAndOpenScripts, copyFixture, isAlive, launch, readPid } from './helpers';

let app: ElectronApplication;
let page: Page;
let project: string;
let closed = false;

test.beforeEach(async () => {
  project = await copyFixture('npm-app');
  ({ app, page } = await launch(project));
  closed = false;
  app.on('close', () => {
    closed = true;
  });
});

test.afterEach(async () => {
  // The quit test closes the app itself; app.process() is gone after a close, so track the event.
  if (!closed) await app.close();
});

test('runs a script, shows its output and stops the whole tree', async () => {
  await addProjectAndOpenScripts(page);
  await page.getByRole('button', { name: 'Start serve' }).click();
  await expect(page.getByRole('log', { name: 'serve output' })).toContainText('listening', { timeout: 30_000 });
  const pid = await readPid(project);
  expect(isAlive(pid)).toBe(true);
  await page.getByRole('button', { name: 'Stop serve' }).click();
  await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false);
  await expect(page.getByRole('button', { name: 'Start serve' })).toBeVisible();
});

test('shows a crashed script with its exit code and last line', async () => {
  await addProjectAndOpenScripts(page);
  await page.getByRole('button', { name: 'Start boom' }).click();
  // The exit code is whatever the package manager passes on; the last line skips its own error noise.
  await expect(page.getByText(/^exit \d+ · kaboom$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('log', { name: 'boom output' })).toContainText('■ exited with code');
});

test('quitting with a running script stops it', async () => {
  await addProjectAndOpenScripts(page);
  await page.getByRole('button', { name: 'Start serve' }).click();
  await expect(page.getByRole('log', { name: 'serve output' })).toContainText('listening', { timeout: 30_000 });
  const pid = await readPid(project);
  // The stubbed confirmation answers "Stop and quit".
  await app.close();
  await expect.poll(() => isAlive(pid), { timeout: 10_000 }).toBe(false);
});
