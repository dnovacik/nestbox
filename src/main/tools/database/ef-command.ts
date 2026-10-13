// The `dotnet ef` command lines NestBox builds: plain words and validated values only, so they are safe
// through cmd.exe. Never --connection (a value), --verbose (prints the connection string) or --force.
import type { EfAction } from '@shared/tools/database/contract';

export interface EfArgsInput {
  action: EfAction;
  /** The project file, relative to the package folder (the cwd). */
  project: string;
  /** Passed only when the package has several contexts. */
  context: string | null;
  environment: string;
  name?: string;
  target?: string;
  /** False when SQLite is the only provider: EF can't script it idempotently. */
  idempotent: boolean;
}

function command(o: EfArgsInput): string[] {
  switch (o.action) {
    case 'list':
      return ['migrations', 'list', '--json'];
    case 'add':
      return ['migrations', 'add', o.name ?? ''];
    case 'update':
      return ['database', 'update', ...(o.target === undefined ? [] : [o.target])];
    case 'script':
      return ['migrations', 'script', ...(o.idempotent ? ['--idempotent'] : [])];
    case 'remove':
      return ['migrations', 'remove'];
    case 'restore':
      return [];
  }
}

/** Arguments for `dotnet`. The environment goes to the app (`-- --environment`) as well as its variables. */
export function efArgs(o: EfArgsInput): string[] {
  if (o.action === 'restore') return ['tool', 'restore'];
  return [
    'ef',
    ...command(o),
    '--project',
    o.project,
    ...(o.context === null ? [] : ['--context', o.context]),
    '--prefix-output',
    '--',
    '--environment',
    o.environment,
  ];
}

/** The `▸` line: the command up to its options, then the environment. */
export function efLabel(args: string[], environment: string): string {
  const end = args.indexOf('--project');
  const words = end === -1 ? args : args.slice(0, end);
  return args[0] === 'ef'
    ? `dotnet ${words.join(' ')} (${environment})`
    : `dotnet ${words.join(' ')}`;
}

/** Updates outside Development, any update to a chosen migration (a rollback) and remove ask first. */
export function needsConfirm(
  action: EfAction,
  environment: string,
  target: string | undefined,
): boolean {
  if (action === 'remove') return true;
  if (action !== 'update') return false;
  return target !== undefined || environment.toLowerCase() !== 'development';
}
