// CLAUDE.md and CLAUDE.local.md: read with a version, written with the version check. The editor in the
// renderer works with LF; a file that used CRLF keeps CRLF.
import { createVersionedFiles } from '../../fs/versioned-file';

export const CLAUDE_DOCS = ['CLAUDE.md', 'CLAUDE.local.md'] as const;
export type ClaudeDoc = (typeof CLAUDE_DOCS)[number];

export const MAX_DOC_BYTES = 1024 * 1024;

export interface ClaudeDocs {
  /** version null: the file does not exist yet (text ''). */
  read(dir: string, file: ClaudeDoc): Promise<{ text: string; version: string | null }>;
  /** version null creates the file (CONFLICT if it appeared meanwhile). */
  write(dir: string, file: ClaudeDoc, text: string, version: string | null): Promise<{ version: string }>;
}

/** Whether a text mostly uses CRLF line endings. */
export const usesCrlf = (text: string) => {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  return crlf > 0 && crlf >= (text.match(/\n/g)?.length ?? 0) - crlf;
};

export function createClaudeDocs(): ClaudeDocs {
  const files = createVersionedFiles({
    allowName: (name) => (CLAUDE_DOCS as readonly string[]).includes(name),
    maxBytes: MAX_DOC_BYTES,
    noun: 'document',
  });

  async function readOrMissing(dir: string, file: ClaudeDoc) {
    try {
      return await files.read(dir, file);
    } catch (error) {
      if ((error as { code?: unknown }).code === 'NOT_FOUND') return { text: '', version: null };
      throw error;
    }
  }

  return {
    read: readOrMissing,
    async write(dir, file, text, version) {
      const lf = text.replace(/\r\n/g, '\n');
      const current = version === null ? null : await readOrMissing(dir, file);
      const out = current && usesCrlf(current.text) ? lf.replace(/\n/g, '\r\n') : lf;
      return files.write(dir, file, out, version);
    },
  };
}
