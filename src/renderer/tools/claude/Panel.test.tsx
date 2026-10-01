import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestboxError } from '@shared/errors';
import type { ClaudeStatus } from '@shared/tools/claude/contract';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import ClaudePanel from './Panel';

const baseStatus: ClaudeStatus = {
  cli: { found: true, version: '2.1.0 (Claude Code)' },
  files: {
    claudeMd: true,
    claudeLocalMd: false,
    commands: [{ name: 'frontend:component', description: 'Make a component' }],
    agents: [],
    skills: [],
    settings: [{ file: '.claude/settings.json', allow: ['Bash(pnpm test)'], deny: [], ask: [], hooks: ['Stop'] }],
    mcpServers: [{ name: 'github', type: 'stdio', command: 'npx', argCount: 2, url: null }],
    unreadable: [],
  },
  gitignore: [],
  promptRunning: false,
};

type Call = { method: string; input: Record<string, unknown> };
type Docs = Record<string, { text: string; version: string | null }>;

function setup(opts: { status?: Partial<ClaudeStatus>; docs?: Docs; over?: Record<string, (input: Record<string, unknown>) => unknown> } = {}) {
  let status: ClaudeStatus = { ...baseStatus, ...opts.status };
  const docs: Docs = {
    'CLAUDE.md': { text: '# Shop\n\nSee [the docs](https://example.com/docs).\n\n<script>alert(1)</script>\n', version: 'v1' },
    'CLAUDE.local.md': { text: '', version: null },
    ...opts.docs,
  };
  const calls: Call[] = [];
  const bridge = installMockBridge({
    'tools:invoke': (({ method, input }: Call) => {
      calls.push({ method, input });
      const handler = opts.over?.[method];
      if (handler) return handler(input);
      switch (method) {
        case 'status':
          return status;
        case 'readDoc':
          return docs[input['file'] as string];
        case 'writeDoc':
          docs[input['file'] as string] = { text: input['text'] as string, version: 'v2' };
          return { version: 'v2' };
        case 'prompt':
          status = { ...status, promptRunning: true };
          return undefined;
        case 'stopPrompt':
        case 'open':
        case 'continue':
        case 'clearPromptLogs':
          return undefined;
        case 'getPromptLogs':
          return { lines: [], firstSeq: 1, lastSeq: 0 };
        case 'contextPreview':
          return { before: '# Shop\nold line\n', after: '# Shop\nnew line\n', version: 'v1' };
        case 'applyContext':
          return { version: 'v3' };
        default:
          throw new Error(`unexpected ${method}`);
      }
    }) as never,
    'app:openExternal': () => undefined,
  });
  renderWithProviders(<ClaudePanel projectId="p1" />);
  return { bridge, of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.input) };
}

// The prompt output is a LogView (react-virtual): give jsdom a layout size.
const layout = { offsetHeight: 400, offsetWidth: 800 };
const originals = Object.fromEntries(Object.keys(layout).map((k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)]));
beforeAll(() => {
  for (const [k, v] of Object.entries(layout)) Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get: () => v });
});
afterAll(() => {
  for (const [k, d] of Object.entries(originals)) if (d) Object.defineProperty(HTMLElement.prototype, k, d);
});

describe('ClaudePanel', () => {
  it('shows the CLI version and opens claude or continues', async () => {
    const { of } = setup();
    expect(await screen.findByText('claude 2.1.0 (Claude Code)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Claude' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(of('open')).toHaveLength(1));
    expect(of('continue')).toHaveLength(1);
  });

  it('explains how to install a missing CLI and disables the actions', async () => {
    setup({ status: { cli: { found: false, version: null } } });
    expect(await screen.findByText(/npm install -g @anthropic-ai\/claude-code/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Claude' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('renders CLAUDE.md as Markdown, with raw HTML as text and links opened externally', async () => {
    const { bridge } = setup();
    const card = await screen.findByRole('region', { name: 'CLAUDE.md' });
    expect(await within(card).findByRole('heading', { name: 'Shop' })).toBeInTheDocument();
    expect(card.querySelector('script')).toBeNull();
    expect(within(card).getByText('<script>alert(1)</script>')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('link', { name: 'the docs' }));
    expect(bridge.callsTo('app:openExternal')).toEqual([{ url: 'https://example.com/docs' }]);
  });

  it('edits and saves with the version it read', async () => {
    const { of } = setup();
    const card = await screen.findByRole('region', { name: 'CLAUDE.md' });
    await userEvent.click(await within(card).findByRole('button', { name: 'Edit' }));
    const editor = within(card).getByRole('textbox', { name: 'Edit CLAUDE.md' });
    await userEvent.clear(editor);
    await userEvent.type(editor, '# New');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(of('writeDoc')).toEqual([{ file: 'CLAUDE.md', text: '# New', version: 'v1' }]));
    expect(await within(card).findByRole('heading', { name: 'New' })).toBeInTheDocument();
  });

  it('reloads on a conflict and keeps the draft', async () => {
    let reads = 0;
    const { of } = setup({
      over: {
        readDoc: (input) =>
          input['file'] === 'CLAUDE.md' ? { text: '# Disk\n', version: `v${++reads}` } : { text: '', version: null },
        writeDoc: () => {
          throw new NestboxError('CONFLICT', 'The file changed on disk. Reload and try again.');
        },
      },
    });
    const card = await screen.findByRole('region', { name: 'CLAUDE.md' });
    await userEvent.click(await within(card).findByRole('button', { name: 'Edit' }));
    await userEvent.type(within(card).getByRole('textbox', { name: 'Edit CLAUDE.md' }), 'mine');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('changed on disk');
    expect(within(card).getByRole('textbox', { name: 'Edit CLAUDE.md' })).toHaveValue('# Disk\nmine');
    await waitFor(() => expect(reads).toBe(2));
    expect(of('writeDoc')).toHaveLength(1);
  });

  it('creates a missing CLAUDE.local.md', async () => {
    const { of } = setup();
    const card = await screen.findByRole('region', { name: 'CLAUDE.local.md' });
    await userEvent.click(await within(card).findByRole('button', { name: 'Create CLAUDE.local.md' }));
    await userEvent.type(within(card).getByRole('textbox', { name: 'Edit CLAUDE.local.md' }), 'notes');
    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(of('writeDoc')).toEqual([{ file: 'CLAUDE.local.md', text: 'notes', version: null }]));
  });

  it('warns about a personal file that is not gitignored', async () => {
    setup({ status: { gitignore: [{ file: 'CLAUDE.local.md', ignored: false }] } });
    expect(await screen.findByText(/is personal but not in \.gitignore/)).toBeInTheDocument();
  });

  it('lists .claude contents and MCP servers by name and command', async () => {
    setup();
    expect(await screen.findByText('/frontend:component')).toBeInTheDocument();
    const mcp = screen.getByRole('list', { name: 'MCP servers' });
    expect(mcp).toHaveTextContent('github');
    expect(mcp).toHaveTextContent('npx · 2 args');
    expect(screen.getByRole('list', { name: 'Settings' })).toHaveTextContent('1 allowed · 0 denied · 0 ask · hooks: Stop');
  });

  it('shows the context diff and applies it with the previewed version', async () => {
    const { of } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Preview update' }));
    const diff = await screen.findByRole('region', { name: 'Changes to CLAUDE.md' });
    expect(within(diff).getByText('- old line')).toHaveAttribute('data-kind', 'remove');
    expect(within(diff).getByText('+ new line')).toHaveAttribute('data-kind', 'add');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(of('applyContext')).toEqual([{ version: 'v1' }]));
  });

  it('runs a prompt, streams its output and stops it', async () => {
    const { of, bridge } = setup();
    await userEvent.type(await screen.findByRole('textbox', { name: 'Prompt' }), 'Explain "x"');
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(of('prompt')).toEqual([{ text: 'Explain "x"' }]));
    act(() => bridge.emit('tools:event', { toolId: 'claude', projectId: 'p1', event: 'changed', payload: undefined }));
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(of('stopPrompt')).toHaveLength(1));
    act(() =>
      bridge.emit('tools:event', {
        toolId: 'claude',
        projectId: 'p1',
        event: 'logs',
        payload: { lines: [{ seq: 1, ts: 1, stream: 'stdout', text: 'It is a component.' }] },
      }),
    );
    const log = await screen.findByRole('log', { name: 'Claude output' });
    expect(await within(log).findByText('It is a component.')).toBeInTheDocument();
  });
});
