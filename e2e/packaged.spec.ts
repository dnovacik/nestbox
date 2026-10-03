import { expect, test } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { copyFixture } from './helpers';

// Smoke test of the packaged app (CI's package job builds it with `electron-builder --dir` on Windows and macOS
// and sets NESTBOX_PACKAGED_EXE to NestBox.exe or NestBox.app/Contents/MacOS/NestBox). It proves the packaged renderer's file URL inside the asar is trusted for IPC
// (isAppUrl) and that main's runtime dependencies were packaged. A packaged app ignores
// NESTBOX_USER_DATA_DIR, so it runs with the runner's real (fresh) profile.
const exe = process.env['NESTBOX_PACKAGED_EXE'];

test.skip(!exe, 'NESTBOX_PACKAGED_EXE is not set');

test('the packaged app starts, answers IPC and adds a project', async () => {
  const project = await copyFixture('npm-app');
  const app = await electron.launch({ executablePath: exe ?? '' });
  try {
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, project);
    const page = await app.firstWindow();
    await expect(page).toHaveTitle('NestBox');
    const info = await page.evaluate(() =>
      (globalThis as unknown as { nestbox: { invoke(channel: string, input: unknown): Promise<unknown> } }).nestbox.invoke('app:getInfo', undefined),
    );
    expect(info).toMatchObject({ ok: true, data: { platform: expect.stringMatching(/^(win32|darwin)$/) } });
    await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'Add project' }).click();
    await expect(page.getByRole('heading', { name: 'nestbox-e2e-app' })).toBeVisible();
    // A tool that depends on packaged node_modules (sirv) loads and answers.
    await page.getByRole('tab', { name: 'Static' }).click();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  } finally {
    // Quit without the close-to-tray prompt: the main process exits directly.
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
  }
});
