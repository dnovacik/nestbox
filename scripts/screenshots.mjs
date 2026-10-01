// Captures the README screenshots from the built app (run `pnpm build` first):
//   node scripts/screenshots.mjs            (Windows, or Linux under xvfb-run)
// It creates demo projects in a temp folder and an isolated profile. Data the platform can't provide
// here (running scripts and their output, listening ports, the claude CLI) is faked by wrapping main's
// IPC handlers, so the pictures look the same on any machine. Writes docs/screenshots/*.png.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');

async function files(dir, entries) {
  for (const [name, text] of Object.entries(entries)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), text);
  }
}

async function demoProjects() {
  // A short, stable folder: its path shows in the header.
  const base = join(tmpdir(), 'Dev');
  await rm(base, { recursive: true, force: true });
  const shop = join(base, 'shop');
  await files(shop, {
    'package.json': JSON.stringify(
      {
        name: 'shop',
        private: true,
        scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview', test: 'vitest', lint: 'eslint .', 'db:migrate': 'prisma migrate dev' },
      },
      null,
      2,
    ),
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    '.env': 'PORT=5173\nDATABASE_URL=postgres://shop:local@localhost:5432/shop\nSTRIPE_SECRET_KEY=sk_test_demo\n',
    '.env.staging': 'PORT=5173\nDATABASE_URL=postgres://shop:staging@db.internal/shop\nSTRIPE_SECRET_KEY=sk_test_staging\nSENTRY_DSN=https://key@sentry.example/1\n',
    '.env.example': 'PORT=5173\nDATABASE_URL=\nSTRIPE_SECRET_KEY=\nSENTRY_DSN=\n',
    'prisma/schema.prisma': 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n',
    'docker-compose.yml': 'services:\n  db:\n    image: postgres:17\n',
    'dist/index.html': '<!doctype html><title>Shop</title><div id="root"></div><script src="/assets/index.js"></script>\n',
    'dist/assets/index.js': 'console.log("shop");\n',
    'CLAUDE.md':
      '# Shop\n\nStorefront built with **Vite + React** and a Prisma/Postgres backend.\n\n## Conventions\n\n- TypeScript strict, no `any`.\n- Tests sit next to the source (`foo.ts` → `foo.test.ts`).\n- Money is stored in cents.\n\n## Commands\n\n| Command | What it does |\n| --- | --- |\n| `pnpm dev` | Vite dev server on port 5173 |\n| `pnpm test` | Vitest |\n',
    '.claude/commands/review.md': '---\ndescription: Review the current diff against our conventions\n---\nReview the diff.\n',
    '.claude/commands/frontend/component.md': '---\ndescription: Scaffold a React component with a test\n---\nCreate it.\n',
    '.claude/agents/db-expert.md': '---\nname: db-expert\ndescription: Prisma schema and migration reviews\n---\n',
    '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(pnpm test)', 'Bash(pnpm lint)'], deny: ['Read(.env)'] }, hooks: { PostToolUse: [] } }),
    '.mcp.json': JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }, sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' } } }),
  });
  const platform = join(base, 'platform');
  await files(platform, {
    'package.json': JSON.stringify({ name: 'platform', private: true, scripts: { dev: 'turbo dev', build: 'turbo build' } }, null, 2),
    'pnpm-lock.yaml': "lockfileVersion: '9.0'\n",
    'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    'packages/api/package.json': JSON.stringify({ name: '@platform/api', scripts: { dev: 'tsx watch src/main.ts', test: 'vitest' } }),
    'packages/web/package.json': JSON.stringify({ name: '@platform/web', scripts: { dev: 'next dev', build: 'next build' } }),
  });
  const blog = join(base, 'blog');
  await files(blog, {
    'package.json': JSON.stringify({ name: 'blog', private: true, scripts: { dev: 'astro dev', build: 'astro build' } }, null, 2),
    'package-lock.json': '{}\n',
  });
  return { shop, platform, blog };
}

const ESC = '\u001b';
const DEV_LOG = [
  ['system', '▸ pnpm run dev'],
  ['stdout', ''],
  ['stdout', '> shop@ dev'],
  ['stdout', '> vite'],
  ['stdout', ''],
  ['stdout', `  ${ESC}[32m${ESC}[1mVITE${ESC}[22m v7.1.4${ESC}[39m  ${ESC}[2mready in ${ESC}[0m${ESC}[1m412${ESC}[22m${ESC}[2m${ESC}[0m ms${ESC}[22m`],
  ['stdout', ''],
  ['stdout', `  ${ESC}[32m➜${ESC}[39m  ${ESC}[1mLocal${ESC}[22m:   ${ESC}[36mhttp://localhost:${ESC}[1m5173${ESC}[22m/${ESC}[39m`],
  ['stdout', `  ${ESC}[32m➜${ESC}[39m  ${ESC}[1mNetwork${ESC}[22m: ${ESC}[2muse ${ESC}[22m${ESC}[1m--host${ESC}[22m${ESC}[2m to expose${ESC}[22m`],
  ['stdout', `${ESC}[36m${ESC}[1m[vite]${ESC}[22m${ESC}[39m ${ESC}[32mhmr update ${ESC}[39m${ESC}[2m/src/pages/Cart.tsx${ESC}[22m`],
  ['stdout', `${ESC}[36m${ESC}[1m[vite]${ESC}[22m${ESC}[39m ${ESC}[32mhmr update ${ESC}[39m${ESC}[2m/src/components/PriceTag.tsx${ESC}[22m`],
  ['stderr', `${ESC}[33mwarning${ESC}[39m: React Router Future Flag Warning: v7_startTransition (src/main.tsx:12:5)`],
  ['stdout', `${ESC}[36m${ESC}[1m[vite]${ESC}[22m${ESC}[39m ${ESC}[32mpage reload ${ESC}[39m${ESC}[2msrc/api/client.ts${ESC}[22m`],
  ['stdout', '{"level":"info","msg":"GET /api/products 200","ms":38}'],
  ['stdout', '{"level":"warn","msg":"slow query","model":"Order","ms":812}'],
];

async function main() {
  const projects = await demoProjects();
  const userData = await mkdtemp(join(tmpdir(), 'nestbox-shots-profile-'));
  const env = Object.fromEntries(
    Object.entries({ ...process.env, NESTBOX_USER_DATA_DIR: userData }).filter(([k, v]) => v !== undefined && k !== 'ELECTRON_RENDERER_URL'),
  );
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 800 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 800));
    const queue = [projects.shop, projects.platform, projects.blog];
    await app.evaluate(({ dialog }, dirs) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dirs.shift() ?? ''] });
    }, queue);
    const sidebar = page.getByRole('complementary', { name: 'Projects' });
    for (const name of ['shop', 'platform', 'blog']) {
      await sidebar.getByRole('button', { name: 'Add project' }).click();
      await sidebar.getByRole('button', { name, exact: true }).waitFor();
    }
    const list = await page.evaluate(() => globalThis.nestbox.invoke('projects:list', undefined));
    const shopId = list.data.find((p) => p.name === 'shop').id;
    const apiId = list.data.find((p) => p.name === 'platform').detected.workspaces[0].id;

    await app.evaluate(({ ipcMain }, fake) => {
      // Electron keeps invoke handlers in this map; replacing one keeps the original for pass-through.
      const handlers = ipcMain._invokeHandlers;
      const wrap = (channel, fn) => {
        const original = handlers.get(channel);
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (event, payload) => {
          const answer = await fn(payload, () => original(event, payload));
          return answer;
        });
      };
      const ok = (data) => ({ ok: true, data });
      const now = Date.now();
      const proc = (projectId, script, pid, minutes) => ({
        projectId, script, state: 'running', pid, startedAt: now - minutes * 60_000, exit: null,
        crashCount: 0, autoRestart: script === 'dev', nextRestartAt: null, gaveUp: false,
      });
      const processes = [proc(fake.shopId, 'dev', 18244, 42), proc(fake.apiId, 'dev', 20112, 12)];
      wrap('processes:list', () => ok(processes));
      wrap('ports:list', () =>
        ok({
          scannedAt: now,
          stale: false,
          rows: [
            { port: 3000, pid: 20140, addresses: ['127.0.0.1'], processName: 'node.exe', command: 'node packages/api/dist/main.js', owner: { projectId: fake.apiId, script: 'dev' } },
            { port: 5173, pid: 18260, addresses: ['[::1]'], processName: 'node.exe', command: 'node node_modules/vite/bin/vite.js', owner: { projectId: fake.shopId, script: 'dev' } },
            { port: 5432, pid: 4120, addresses: ['0.0.0.0', '[::]'], processName: 'postgres.exe', command: null, owner: null },
            { port: 6379, pid: 5208, addresses: ['127.0.0.1'], processName: 'redis-server.exe', command: 'redis-server --port 6379', owner: null },
            { port: 8080, pid: 9932, addresses: ['0.0.0.0'], processName: 'java.exe', command: 'java -jar keycloak.jar start-dev', owner: null },
          ],
        }),
      );
      wrap('tools:invoke', async (payload, pass) => {
        if (payload?.toolId === 'scripts' && payload.method === 'getLogs' && payload.input?.script === 'dev') {
          const lines = fake.devLog.map(([stream, text], i) => ({ seq: i + 1, ts: now - (fake.devLog.length - i) * 4_000, stream, text }));
          return ok({ lines, firstSeq: 1, lastSeq: lines.length });
        }
        const result = await pass();
        if (payload?.toolId === 'claude' && payload.method === 'status' && result.ok) {
          result.data.cli = { found: true, version: '2.1.0 (Claude Code)' };
          result.data.gitignore = result.data.gitignore.map((g) => ({ ...g, ignored: true }));
        }
        return result;
      });
    }, { shopId, apiId, devLog: DEV_LOG });
    // Everything fetched before the stubs is refetched through them.
    await page.reload();
    await sidebar.getByRole('button', { name: 'shop', exact: true }).waitFor();

    await mkdir(OUT, { recursive: true });
    const shot = async (name) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, `${name}.png`) });
      console.log(`docs/screenshots/${name}.png`);
    };
    await sidebar.getByRole('button', { name: 'shop', exact: true }).click();
    await page.getByRole('heading', { name: 'shop' }).waitFor();
    await shot('overview');

    await page.getByRole('tab', { name: 'Scripts' }).click();
    await page.getByRole('button', { name: 'dev', exact: true }).click();
    await page.getByText('ready in').waitFor();
    await shot('scripts');

    await page.getByRole('tab', { name: 'Env' }).click();
    await page.getByRole('table', { name: 'Env files' }).waitFor();
    await shot('env');

    await page.getByRole('tab', { name: 'Static' }).click();
    await page.getByRole('button', { name: 'Start' }).click();
    const url = await page.getByRole('link', { name: /^http:\/\/localhost:/ }).first().textContent();
    for (const path of ['', 'assets/index.js', 'products/42', 'favicon.ico']) await fetch(`${url.replace('localhost', '127.0.0.1')}${path}`).catch(() => undefined);
    await page.getByText('GET /products/42').waitFor();
    await shot('static');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();

    await page.getByRole('tab', { name: 'Claude Code' }).click();
    await page.getByRole('region', { name: 'CLAUDE.md' }).getByRole('heading', { name: 'Shop' }).waitFor();
    await shot('claude');

    await page.getByRole('button', { name: 'Ports', exact: true }).click();
    await page.getByText('postgres.exe').first().waitFor();
    await shot('ports');

    await sidebar.getByRole('button', { name: 'shop', exact: true }).click();
    // Lower-case: 'Control+K' would add Shift, which the shortcut deliberately ignores.
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog').waitFor();
    await page.keyboard.type('dev');
    await page.waitForTimeout(200);
    await shot('palette');
  } finally {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined);
  }
}

await main();
