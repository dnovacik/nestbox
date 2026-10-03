import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { TodoScan } from '@shared/tools/todos/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { todo, todoScan } from './fixtures';
import TodosPanel, { MAX_ROWS } from './Panel';

type Call = { method: string; input: unknown };

function setup(result: TodoScan, tags = ['TODO', 'FIXME', 'HACK']) {
  const calls: Call[] = [];
  let current = tags;
  installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      switch (method) {
        case 'results':
        case 'scan':
          return result;
        case 'getTags':
          return current;
        case 'setTags':
          current = (input as { tags: string[] }).tags;
          return current;
        default:
          return undefined;
      }
    }) as never,
  });
  renderWithProviders(<TodosPanel projectId="p1" />);
  return { of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

const SAMPLE = todoScan([
  todo('src/a.ts', 3, 'TODO', 'wire the cache'),
  todo('src/a.ts', 9, 'FIXME', 'null check', 'dan'),
  todo('scripts/build.py', 1, 'HACK', 'temporary path'),
]);

describe('TodosPanel', () => {
  it('groups TODOs by file and opens one at its line', async () => {
    const { of } = setup(SAMPLE);
    const files = await screen.findByRole('list', { name: 'Files with TODOs' });
    const a = within(files).getByRole('list', { name: 'src/a.ts' });
    expect(within(a).getAllByRole('button').map((b) => b.textContent)).toEqual(['3TODOwire the cache', '9FIXMEnull checkdan']);
    await userEvent.click(within(a).getByRole('button', { name: /null check/ }));
    expect(of('openFile')).toEqual([{ path: 'src/a.ts', line: 9 }]);
  });

  it('filters by tag and by text', async () => {
    setup(SAMPLE);
    await screen.findByRole('list', { name: 'Files with TODOs' });
    await userEvent.click(screen.getByRole('button', { name: 'HACK 1', pressed: true }));
    expect(screen.queryByRole('list', { name: 'scripts/build.py' })).toBeNull();
    await userEvent.type(screen.getByRole('textbox', { name: 'Search TODOs' }), 'cache');
    expect(screen.getAllByRole('button', { name: /wire the cache/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /null check/ })).toBeNull();
  });

  it('edits the tags', async () => {
    const { of } = setup(SAMPLE);
    const tags = await screen.findByRole('region', { name: 'Tags' });
    await within(tags).findByText('FIXME');
    await userEvent.click(within(tags).getByRole('button', { name: 'Remove HACK' }));
    await userEvent.type(within(tags).getByRole('textbox', { name: 'New tag' }), 'note{Enter}');
    expect(of('setTags')).toEqual([{ tags: ['TODO', 'FIXME'] }, { tags: ['TODO', 'FIXME', 'NOTE'] }]);
  });

  it('refreshes on demand', async () => {
    const { of } = setup(SAMPLE);
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    expect(of('scan')).toHaveLength(1);
  });

  it(`draws at most ${MAX_ROWS} rows and says so`, async () => {
    const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => todo(`f${String(i).padStart(4, '0')}.ts`, 1, 'TODO', `n${i}`));
    setup(todoScan(many));
    expect(await screen.findByText(`Showing the first 1,000 of 1,005. Filter to see the rest.`)).toBeInTheDocument();
  });

  it('says when nothing was found', async () => {
    setup(todoScan([]));
    expect(await screen.findByText('No tagged comments found.')).toBeInTheDocument();
  });
});
