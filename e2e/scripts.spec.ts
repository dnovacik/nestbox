import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { addProjectAndOpenScripts, copyFixture, isAlive, launch, messageBoxes, readPid } from './helpers';

let app: ElectronApplication;
let page: Page;
let project: string;
let userData: string;
let closed = false;

function track(launched: ElectronApplication): void {
  closed = false;
  launched.on('close', () => {
    closed = true;
  });
}

test.beforeEach(async () => {
  project = await copyFixture('npm-app');
  ({ app, page, userData } = await launch(project));
  track(app);
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

test('offers to stop a script left running when Nestbox itself was killed', async () => {
  await addProjectAndOpenScripts(page);
  await page.getByRole('button', { name: 'Start serve' }).click();
  await expect(page.getByRole('log', { name: 'serve output' })).toContainText('listening', { timeout: 30_000 });
  const serverPid = await readPid(project);

  // Kill only the main process, like ending electron.exe in Task Manager's Details tab. Its children
  // (cmd.exe, npm, the server) are not part of a job, so they keep running.
  const mainPid = app.process().pid;
  if (mainPid === undefined) throw new Error('no main pid');
  process.kill(mainPid, 'SIGKILL');
  // Playwright's 'close' event does not fire for a killed main process: watch the PID instead.
  await expect.poll(() => isAlive(mainPid), { timeout: 10_000 }).toBe(false);
  closed = true;
  expect(isAlive(serverPid)).toBe(true);
  // The single-instance lock is the userData 'lockfile' (delete-on-close). Relaunching before Windows
  // has released it makes the new instance quit at once, so wait for it to go.
  // TEMPORARY diagnostics: find out who keeps the lock after the main process is gone.
  const lock = join(userData, 'lockfile');
  const deadline = Date.now() + 8_000;
  while (existsSync(lock) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  if (existsSync(lock)) {
    const ps = (cmd: string) => {
      try {
        return execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
      } catch (e) {
        return String(e);
      }
    };
    console.log(`[diag] lock held after main exit; server ${serverPid}`);
    console.log(
      ps(
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'electron|node|cmd|crashpad' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | Format-Table -AutoSize -Wrap | Out-String -Width 400",
      ),
    );
    execFileSync('taskkill.exe', ['/PID', String(serverPid), '/T', '/F']);
    await new Promise((r) => setTimeout(r, 2_000));
    console.log(`[diag] lock after killing the server: ${existsSync(lock) ? 'still held' : 'released'}`);
    console.log(ps("Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'electron|node|cmd|crashpad' } | Select-Object ProcessId,ParentProcessId,Name | Format-Table -AutoSize | Out-String -Width 400"));
  }
  expect(existsSync(lock), 'single-instance lock released').toBe(false);

  ({ app, page } = await launch(project, { userData }));
  track(app);
  // The stubbed prompt answers "Stop them".
  await expect
    .poll(() => messageBoxes(app), { timeout: 30_000 })
    .toContainEqual('1 script from the last session is still running');
  await expect.poll(() => isAlive(serverPid), { timeout: 10_000 }).toBe(false);
});
