import { execFileSync, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

const hasGit = spawnSync('git', ['--version']).status === 0;
const TABS = ['Overview', 'Project info', 'Scripts', 'Env', 'Static', 'Claude Code', ...(hasGit ? ['Git'] : []), 'Database', 'TODOs', 'Health', 'Compose', 'Mock API', 'Inspector'];

let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  const project = await copyFixture('npm-app');
  // A repository, so the Git tab is there too.
  if (hasGit) execFileSync('git', ['init', '-q'], { cwd: project, stdio: 'pipe' });
  // An env file, so the Database tab is there too (port 1: nothing answers, which is fine here).
  await writeFile(join(project, '.env'), 'DATABASE_URL=postgresql://u@127.0.0.1:1/shop\n');
  // A compose file, so the Compose tab is there too (answered by the fake docker).
  await writeFile(join(project, 'compose.yaml'), 'services:\n  db:\n    image: postgres:17\n');
  ({ app, page } = await launch(project, { pathPrepend: join(__dirname, 'fixtures', 'fake-docker') }));
  // Short enough that the longer panels don't fit.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 480));
  await page.getByRole('complementary', { name: 'Projects' }).getByRole('button', { name: 'Add project' }).click();
});

test.afterEach(async () => {
  await app.close();
});

test('every tab has the same 24 px inset', async () => {
  for (const name of TABS) {
    await page.getByRole('tab', { name, exact: true }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.locator(':scope *:visible').first()).toBeVisible();
    // The left and top edges of everything the panel shows, measured from the panel's own edges.
    const inset = await panel.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const kids = [...el.querySelectorAll('*')].map((k) => k.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      return {
        left: Math.round(Math.min(...kids.map((r) => r.left)) - box.left),
        top: Math.round(Math.min(...kids.map((r) => r.top)) - box.top),
      };
    });
    expect(inset, name).toEqual({ left: 24, top: 24 });
  }
});

/** The panel fits inside its tab and scrolls, instead of growing past the window and being clipped. */
async function expectScrolls(name: string) {
  const region = page.getByRole('region', { name, exact: true });
  await expect(region).toBeVisible();
  const box = await region.evaluate((el) => {
    const panel = el.closest('[role="tabpanel"]');
    el.scrollTop = 10_000;
    return { bottom: el.getBoundingClientRect().bottom, panelBottom: panel?.getBoundingClientRect().bottom ?? 0, scrollTop: el.scrollTop };
  });
  expect(box.bottom).toBeLessThanOrEqual(box.panelBottom + 1);
  expect(box.scrollTop).toBeGreaterThan(0);
}

test('the Claude Code panel scrolls in a short window', async () => {
  await page.getByRole('tab', { name: 'Claude Code' }).click();
  await expectScrolls('Claude Code');
});

test('the Static panel scrolls in a short window', async () => {
  await page.getByRole('tab', { name: 'Static' }).click();
  await expectScrolls('Static server');
});

test('the tab bar scrolls by itself instead of widening the window', async () => {
  const tablist = page.getByRole('tablist', { name: 'Project tools' });
  await expect(tablist).toBeVisible();
  const sizes = await tablist.evaluate((el) => ({
    pageOverflow: el.ownerDocument.documentElement.scrollWidth - el.ownerDocument.documentElement.clientWidth,
    tabsOverflow: el.scrollWidth - el.clientWidth,
    heights: [...el.querySelectorAll('[role="tab"]')].map((t) => Math.round(t.getBoundingClientRect().height)),
  }));
  expect(sizes.pageOverflow).toBe(0);
  // Every tab stays on one line.
  expect(new Set(sizes.heights).size).toBe(1);
  // The last tab can be reached: selecting it scrolls it into view.
  await page.getByRole('tab', { name: 'Inspector' }).click();
  const box = await page.getByRole('tab', { name: 'Inspector' }).boundingBox();
  const bar = await tablist.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((bar?.x ?? 0) + (bar?.width ?? 0) + 1);
});
