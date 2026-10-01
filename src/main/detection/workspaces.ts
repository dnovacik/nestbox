import type { DetectOptions } from './detect-project';

export async function findWorkspaceDirs(
  _root: string,
  _packageJson: Record<string, unknown> | null,
  _options: DetectOptions = {},
): Promise<string[]> {
  return [];
}
