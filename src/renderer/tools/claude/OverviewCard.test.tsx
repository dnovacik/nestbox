import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { installMockBridge } from '@/test/mock-bridge';
import { renderWithProviders } from '@/test/render';
import { ClaudeCard } from './OverviewCard';

describe('ClaudeCard', () => {
  it('shows the CLI and a summary of the Claude files', async () => {
    installMockBridge({
      'tools:invoke': (() => ({
        cli: { found: false, version: null },
        files: { claudeMd: true, claudeLocalMd: false, commands: [], agents: [], skills: [], settings: [], mcpServers: [], unreadable: [] },
        gitignore: [],
        promptRunning: false,
      })) as never,
    });
    renderWithProviders(<ClaudeCard projectId="p1" />);
    const card = await screen.findByRole('region', { name: 'Claude Code' });
    expect(await within(card).findByText('claude not installed')).toBeInTheDocument();
    expect(within(card).getByText('CLAUDE.md · 0 commands · 0 MCP servers')).toBeInTheDocument();
  });
});
