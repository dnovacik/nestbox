// Node.js detection of one folder: a package.json (read once, capped: name, scripts, the packageManager
// field and dependency names), the manager from the lockfile's name, else that field, and the framework.
import { type NodeInfo, NodeInfoSchema } from '@shared/ecosystems/node';
import type { DetectContext } from '../types';
import { detectFramework } from './framework';
import { detectMonorepo } from './monorepo';
import { readPackageJson, readPackageJsonChecked } from './package-json';
import { isNxRoot, readNxProject } from './nx';
import { nodePorts } from './ports';
import { choosePackageManager, lockfilesIn } from './package-manager';

export { NodeInfoSchema, type NodeInfo };

/** The manager a lockfile names; null when it came from the packageManager field or npm's default. */
export function lockfileManager(info: NodeInfo): NodeInfo['packageManager'] | null {
  return info.packageManagerSource === 'lockfile' ? info.packageManager : null;
}

function hasDependencies(json: Record<string, unknown> | null): boolean {
  return ['dependencies', 'devDependencies'].some((field) => {
    const deps = json?.[field];
    return (
      !!deps && typeof deps === 'object' && !Array.isArray(deps) && Object.keys(deps).length > 0
    );
  });
}

function scriptsOf(json: Record<string, unknown> | null): Record<string, string> {
  const scripts = json?.['scripts'];
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return {};
  return Object.fromEntries(
    Object.entries(scripts).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

/**
 * Detect Node.js projects by looking for package.json (or, under an Nx root, a project.json alone), and pick
 * the package manager (choosePackageManager): the lockfile's name, else the packageManager field, else npm.
 * A workspace package takes the root's lockfile, then the root's field, first.
 */
export async function detectNode(
  dir: string,
  files: ReadonlySet<string>,
  _dirs: ReadonlySet<string>,
  ctx?: DetectContext,
): Promise<NodeInfo | null> {
  const root = ctx?.root ?? null;
  let rootJson: Promise<Record<string, unknown> | null> | undefined;
  const readRoot = () =>
    (rootJson ??= root?.files.has('package.json')
      ? readPackageJson(root.path)
      : Promise.resolve(null));
  const hasPackageJson = files.has('package.json');
  const underNx = async () => (root ? isNxRoot(root.files, await readRoot()) : false);
  // A project.json without package.json counts only inside an Nx workspace.
  if (!hasPackageJson && !(files.has('project.json') && (await underNx()))) return null;
  let json: Record<string, unknown> | null = null;
  if (hasPackageJson) {
    const read = await readPackageJsonChecked(dir);
    if ('problem' in read) ctx?.onWarning?.('package.json', read.problem);
    json = 'json' in read ? read.json : null;
  }
  const rawName = json?.['name'];
  const packageName = typeof rawName === 'string' && rawName.trim() ? rawName : null;
  const nx =
    files.has('project.json') && (root ? await underNx() : isNxRoot(files, json))
      ? await readNxProject(dir, packageName)
      : null;
  const fromLockfile = choosePackageManager({ files, root: root && { files: root.files } });
  const { manager, source } =
    fromLockfile.source === 'lockfile'
      ? fromLockfile
      : choosePackageManager({
          files,
          field: json?.['packageManager'],
          root: root && {
            files: root.files,
            field: (await readRoot())?.['packageManager'],
          },
        });
  const rootLockfiles = root ? lockfilesIn(root.files) : [];
  const framework = detectFramework(json);
  const scripts = scriptsOf(json);
  return {
    name: packageName ?? nx?.project ?? null,
    packageJson: hasPackageJson,
    scripts,
    packageManager: manager,
    packageManagerSource: source,
    lockfiles: rootLockfiles.length > 0 ? rootLockfiles : lockfilesIn(files),
    framework,
    ports: nodePorts(scripts, framework),
    hasDependencies: hasDependencies(json),
    monorepo: root ? null : await detectMonorepo(dir, files, json),
    nx,
  };
}
