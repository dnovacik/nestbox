import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { type GitFile, MAX_GIT_FILES } from '@shared/tools/git/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { okStatus } from './fixtures';
import GitPanel from './Panel';

const file = (path: string, group: GitFile['group'], status: string, patch: Partial<GitFile> = {}): GitFile => ({
  path,
  origPath: null,
  group,
  status,
  exists: true,
  ...patch,
});

function setup(files: GitFile[], changes = { total: files.length, staged: 0, unstaged: 0, untracked: 0, conflicted: 0, truncated: false }) {
  const bridge = installMockBridge({
    'tools:invoke': ((input: { method: string }) => (input.method === 'status' ? okStatus({ files, changes }) : undefined)) as never,
  });
  renderWithProviders(<GitPanel projectId="p1" />);
  return bridge;
}

describe('GitPanel', () => {
  it('groups files as conflicts, staged, changes and untracked', async () => {
    setup([
      file('src/a.ts', 'changes', 'M'),
      file('src/new.ts', 'staged', 'A'),
      file('notes.md', 'untracked', '?'),
      file('both.ts', 'conflicts', 'U'),
      file('src/b.ts', 'staged', 'R', { origPath: 'src/old.ts' }),
    ]);
    const groups = await screen.findAllByRole('list');
    const titles = (await screen.findAllByRole('heading', { level: 4 })).map((h) => h.textContent);
    expect(titles).toEqual(['Conflicts1', 'Staged2', 'Changes1', 'Untracked1']);
    expect(within(groups[1] as HTMLElement).getByText('src/old.ts → src/b.ts')).toBeInTheDocument();
  });

  it('opens a file in the editor, and offers nothing for a deleted one', async () => {
    const bridge = setup([file('src/a b.ts', 'changes', 'M'), file('gone.ts', 'changes', 'D', { exists: false })]);
    await userEvent.click(await screen.findByRole('button', { name: 'Open src/a b.ts' }));
    expect(bridge.callsTo('tools:invoke')).toContainEqual({ toolId: 'git', projectId: 'p1', method: 'openFile', input: { path: 'src/a b.ts' } });
    expect(screen.queryByRole('button', { name: 'Open gone.ts' })).toBeNull();
  });

  it('says when the list is cut short', async () => {
    const files = Array.from({ length: MAX_GIT_FILES }, (_, i) => file(`f${i}`, 'untracked', '?'));
    setup(files, { total: 900, staged: 0, unstaged: 0, untracked: 900, conflicted: 0, truncated: false });
    expect(await screen.findByText(`Only the first ${MAX_GIT_FILES} files are listed.`)).toBeInTheDocument();
  });

  it('says the working tree is clean', async () => {
    setup([]);
    expect(await screen.findByText('Nothing to commit, working tree clean.')).toBeInTheDocument();
  });

  it('refreshes on demand', async () => {
    const bridge = setup([]);
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    expect(bridge.callsTo('tools:invoke').length).toBe(2);
  });
});
