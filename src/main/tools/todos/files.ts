// Which files a TODO scan reads. In a git repository git lists them, applying every .gitignore exactly as
// git does; elsewhere a folder walk skips dependency and build folders and applies the root .gitignore.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ignore from 'ignore';
import { glob } from 'tinyglobby';

/** git ls-files output cap: tens of thousands of paths. */
export const LS_MAX_BYTES = 8 * 1024 * 1024;

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.turbo', '.cache'];

export interface FileList {
  source: 'git' | 'walk';
  /** Relative, '/'-separated. */
  files: string[];
  truncated: boolean;
}

export function parseLsFiles(stdout: string, truncated: boolean): string[] {
  const paths = stdout.split('\0');
  // Every complete path ends with a NUL: the text after the last one is empty or cut off.
  paths.pop();
  return truncated ? paths : paths.filter((p) => p !== '');
}

export async function walkFiles(dir: string, opts: { maxFiles: number }): Promise<{ files: string[]; truncated: boolean }> {
  const all = await glob('**/*', {
    cwd: dir,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: SKIP_DIRS.map((d) => `**/${d}/**`),
  });
  const rules = await readFile(join(dir, '.gitignore'), 'utf8').catch(() => '');
  const ig = ignore().add(rules);
  const files = all.filter((f) => !ig.ignores(f)).sort();
  return files.length > opts.maxFiles ? { files: files.slice(0, opts.maxFiles), truncated: true } : { files, truncated: false };
}

export async function listFiles(
  dir: string,
  opts: { exec(args: string[]): Promise<{ code: number | null; stdout: string }>; maxFiles: number },
): Promise<FileList> {
  const result = await opts.exec(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).catch(() => null);
  if (result?.code === 0) {
    const files = parseLsFiles(result.stdout, result.stdout.length >= LS_MAX_BYTES);
    const truncated = result.stdout.length >= LS_MAX_BYTES || files.length > opts.maxFiles;
    return { source: 'git', files: files.slice(0, opts.maxFiles), truncated };
  }
  return { source: 'walk', ...(await walkFiles(dir, opts)) };
}
