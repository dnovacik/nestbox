// Parses a raw commit object (`git cat-file commit HEAD`). Only the author's name, the time and the subject
// leave this function; the email and the body are dropped.

export interface CommitSummary {
  subject: string;
  author: string;
  /** Author time, ms since the epoch. */
  at: number;
}

export function parseCommit(raw: string): CommitSummary | null {
  const lines = raw.split(/\r?\n/);
  const blank = lines.indexOf('');
  const headers = blank === -1 ? lines : lines.slice(0, blank);
  // Continuation lines of a multi-line header (gpgsig) start with a space and never match.
  const author = headers.map((line) => /^author (.*) <[^>]*> (\d+) [+-]\d{4}$/.exec(line)).find((m) => m !== null);
  if (!author) return null;
  const subject = blank === -1 ? '' : (lines[blank + 1] ?? '');
  return { subject, author: author[1] ?? '', at: Number(author[2]) * 1000 };
}
