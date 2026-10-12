import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: process.cwd() });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'fatal');
}

// The first lintText loads the whole config (typescript-eslint included): over 5 s on a busy macOS runner.
describe('custom lint rules', { timeout: 30_000 }, () => {
  it('rejects process.platform outside src/main/platform', async () => {
    const ids = await ruleIds('export const p = process.platform;\n', 'src/main/services/x.ts');
    expect(ids).toContain('no-restricted-properties');
  });

  it('allows process.platform inside src/main/platform', async () => {
    const ids = await ruleIds('export const p = process.platform;\n', 'src/main/platform/x.ts');
    expect(ids).not.toContain('no-restricted-properties');
  });

  it('rejects process.platform in the renderer', async () => {
    const ids = await ruleIds('export const p = process.platform;\n', 'src/renderer/x.ts');
    expect(ids).toContain('no-restricted-properties');
  });

  it('rejects hex colours in renderer string and template literals', async () => {
    const a = await ruleIds("export const c = 'bg-[#0D1117]';\n", 'src/renderer/app/x.tsx');
    const b = await ruleIds('export const c = `text-[#fff] ${1}`;\n', 'src/renderer/app/x.tsx');
    expect(a).toContain('no-restricted-syntax');
    expect(b).toContain('no-restricted-syntax');
  });

  it('allows hex colours in main-process code', async () => {
    const ids = await ruleIds("export const c = '#161B22';\n", 'src/main/window-theme.ts');
    expect(ids).not.toContain('no-restricted-syntax');
  });
});
