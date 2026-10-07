import { execFileSync, spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { copyFixture, launch } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const hasGit = spawnSync('git', ['--version']).status === 0;
const TABS = [
  'Overview',
  'Project info',
  'Scripts',
  'Env',
  'Static',
  'Claude Code',
  ...(hasGit ? ['Git'] : []),
  'Database',
  'TODOs',
  'Health',
  'Compose',
  'Mock API',
  'Inspector',
  'Deploy',
];

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
  // A fly.toml, so the Deploy tab is there too (without flyctl it shows the install link, which is fine here).
  await writeFile(join(project, 'fly.toml'), "app = 'npm-app'\n");
  ({ app, page } = await launch(project, {
    pathPrepend: join(__dirname, 'fixtures', 'fake-docker'),
  }));
  // Short enough that the longer panels don't fit.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1000, 480));
  await page
    .getByRole('complementary', { name: 'Projects' })
    .getByRole('button', { name: 'Add project' })
    .click();
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
      const htmlEl = el as any;
      const box = htmlEl.getBoundingClientRect();
      const kids = [...htmlEl.querySelectorAll('*')]
        .map((k: any) => k.getBoundingClientRect())
        .filter((r: any) => r.width > 0 && r.height > 0);
      return {
        left: Math.round(Math.min(...kids.map((r: any) => r.left)) - box.left),
        top: Math.round(Math.min(...kids.map((r: any) => r.top)) - box.top),
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
    const htmlEl = el as any;
    const panel = htmlEl.closest('[role="tabpanel"]');
    htmlEl.scrollTop = 10_000;
    return {
      bottom: htmlEl.getBoundingClientRect().bottom,
      panelBottom: panel?.getBoundingClientRect().bottom ?? 0,
      scrollTop: htmlEl.scrollTop,
    };
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
  const sizes = await tablist.evaluate((el) => {
    const htmlEl = el as any;
    return {
      pageOverflow:
        htmlEl.ownerDocument.documentElement.scrollWidth - htmlEl.ownerDocument.documentElement.clientWidth,
      tabsOverflow: htmlEl.scrollWidth - htmlEl.clientWidth,
      heights: [...htmlEl.querySelectorAll('[role="tab"]')].map((t: any) =>
        Math.round(t.getBoundingClientRect().height),
      ),
    };
  });
  expect(sizes.pageOverflow).toBe(0);
  // Every tab stays on one line.
  expect(new Set(sizes.heights).size).toBe(1);
  // The last tab can be reached: selecting it scrolls it into view.
  await page.getByRole('tab', { name: 'Inspector' }).click();
  const box = await page.getByRole('tab', { name: 'Inspector' }).boundingBox();
  const bar = await tablist.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
    (bar?.x ?? 0) + (bar?.width ?? 0) + 1,
  );
});

test('tabs that do not fit are reached with the scroll arrows', async () => {
  const bar = page.getByRole('tablist', { name: 'Project tools' });
  const right = page.getByRole('button', { name: 'Scroll tabs right' });
  const left = page.getByRole('button', { name: 'Scroll tabs left' });
  await expect(right).toBeVisible();
  await expect(left).toHaveCount(0);
  await right.click();
  await expect.poll(() => bar.evaluate((el) => (el as any).scrollLeft)).toBeGreaterThan(0);
  await expect(left).toBeVisible();
  // At the far end the right arrow goes away.
  await bar.evaluate((el) => {
    const htmlEl = el as any;
    htmlEl.scrollTo({ left: htmlEl.scrollWidth });
  });
  await expect(right).toHaveCount(0);
});
