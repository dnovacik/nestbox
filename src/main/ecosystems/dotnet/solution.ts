// Solution files: the project paths a .sln or .slnx lists, relative to the solution's folder with `/`
// separators. Nothing else is read (no configurations, GUIDs or solution items).

/** `Project("{type}") = "Name", "path\to\Name.csproj", "{id}"`: only real project files, never solution folders. */
const SLN_PROJECT =
  /^Project\s*\("\{[0-9A-F-]+\}"\)\s*=\s*"[^"]*"\s*,\s*"([^"]+\.(?:cs|fs|vb)proj)"\s*,/i;
/** `<Project Path="src/Api/Api.csproj" />` in an .slnx. */
const SLNX_PROJECT = /<Project\b[^>]*\bPath\s*=\s*"([^"]+\.(?:cs|fs|vb)proj)"/gi;

export const SOLUTION_FILE = /\.slnx?$/i;
export const PROJECT_FILE = /\.(?:cs|fs|vb)proj$/i;

const decode = (path: string): string =>
  path
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\\/g, '/');

export function parseSolution(fileName: string, content: string): string[] {
  const text = content.replace(/^\uFEFF/, '');
  if (/\.slnx$/i.test(fileName))
    return [...text.matchAll(SLNX_PROJECT)].map((m) => decode(m[1] ?? ''));
  const paths: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const path = SLN_PROJECT.exec(line.trim())?.[1];
    if (path) paths.push(path.replace(/\\/g, '/'));
  }
  return paths;
}

/** Test projects stay out of the package list: the solution's own `dotnet test` runs them. */
export function isTestName(name: string): boolean {
  return /^tests?([._-]|$)/i.test(name) || /[._-]tests?$/i.test(name) || /[a-z]Tests?$/.test(name);
}
