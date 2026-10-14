// The last dependency check per package and ecosystem, in userData/deps-cache.json, so cards and the Dependencies page have
// data after a restart. Holds names, versions, ranges and advisory data only; never command output.
import * as fs from 'node:fs';
import { z } from 'zod';
import { type PackageResult, PackageResultSchema } from '@shared/tools/deps/contract';
import { errorCode } from '../../error-code';
import type { Logger } from '../../logger';

/** Results written before ecosystems had checks of their own carry no ecosystem: their manager says it. */
const StoredResultSchema = PackageResultSchema.extend({
  ecosystem: PackageResultSchema.shape.ecosystem.optional(),
}).transform((r): PackageResult => ({
  ...r,
  ecosystem: r.ecosystem ?? (r.manager === 'dotnet' ? 'dotnet' : 'node'),
}));

const FileSchema = z.object({
  version: z.literal(1),
  results: z.record(z.string(), StoredResultSchema),
});

/** One entry per package and ecosystem. */
const keyOf = (r: Pick<PackageResult, 'projectId' | 'ecosystem'>) =>
  `${r.projectId}#${r.ecosystem}`;

/** Node first, as the checks run. */
const nodeFirst = (a: PackageResult, b: PackageResult) =>
  Number(b.ecosystem === 'node') - Number(a.ecosystem === 'node');

export interface DepsCache {
  /** Every ecosystem's last result for a package, Node first. */
  forPackage(projectId: string): PackageResult[];
  all(): PackageResult[];
  set(result: PackageResult): void;
  /** Drops the entries whose project id matches (a removed project and its packages). */
  forget(matches: (projectId: string) => boolean): void;
}

export function createDepsCache(file: string, logger: Logger): DepsCache {
  const results = new Map<string, PackageResult>(read().map((r) => [keyOf(r), r]));

  function read(): PackageResult[] {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    try {
      return Object.values(FileSchema.parse(JSON.parse(text)).results);
    } catch {
      logger.warn('deps cache unreadable');
      return [];
    }
  }

  function persist(): void {
    try {
      fs.writeFileSync(
        `${file}.tmp`,
        JSON.stringify({ version: 1, results: Object.fromEntries(results) }),
      );
      fs.renameSync(`${file}.tmp`, file);
    } catch (error) {
      logger.warn('deps cache write failed', { code: errorCode(error) });
    }
  }

  return {
    forPackage: (projectId) =>
      [...results.values()].filter((r) => r.projectId === projectId).sort(nodeFirst),
    all: () => [...results.values()],
    set(result) {
      results.set(keyOf(result), result);
      persist();
    },
    forget(matches) {
      const before = results.size;
      for (const [key, r] of [...results]) if (matches(r.projectId)) results.delete(key);
      if (results.size !== before) persist();
    },
  };
}
