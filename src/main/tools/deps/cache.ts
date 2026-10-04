// The last dependency check per package, in userData/deps-cache.json, so cards and the Dependencies page have
// data after a restart. Holds names, versions, ranges and advisory data only; never command output.
import * as fs from 'node:fs';
import { z } from 'zod';
import { type PackageResult, PackageResultSchema } from '@shared/tools/deps/contract';
import { errorCode } from '../../error-code';
import type { Logger } from '../../logger';

const FileSchema = z.object({
  version: z.literal(1),
  results: z.record(z.string(), PackageResultSchema),
});

export interface DepsCache {
  get(projectId: string): PackageResult | undefined;
  all(): PackageResult[];
  set(result: PackageResult): void;
  /** Drops the entries whose project id matches (a removed project and its packages). */
  forget(matches: (projectId: string) => boolean): void;
}

export function createDepsCache(file: string, logger: Logger): DepsCache {
  const results = new Map<string, PackageResult>(Object.entries(read()));

  function read(): Record<string, PackageResult> {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return {};
    }
    try {
      return FileSchema.parse(JSON.parse(text)).results;
    } catch {
      logger.warn('deps cache unreadable');
      return {};
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
    get: (projectId) => results.get(projectId),
    all: () => [...results.values()],
    set(result) {
      results.set(result.projectId, result);
      persist();
    },
    forget(matches) {
      const before = results.size;
      for (const id of [...results.keys()]) if (matches(id)) results.delete(id);
      if (results.size !== before) persist();
    },
  };
}
