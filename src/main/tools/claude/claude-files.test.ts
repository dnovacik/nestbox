import { afterEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from '../../detection/test-fixtures';
import { readClaudeFiles } from './claude-files';

let dir = '';
afterEach(async () => removeTree(dir));

const TOKEN = 'ghp_SECRETTOKEN123';

describe('readClaudeFiles', () => {
  it('lists commands, agents, skills, settings and MCP servers', async () => {
    dir = await makeTree({
      'CLAUDE.md': '# Shop',
      '.claude/commands/deploy.md': '---\ndescription: Deploy to staging\n---\nRun the deploy.',
      '.claude/commands/frontend/component.md': 'Make a component.',
      '.claude/agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews diffs\ntools: Read, Grep\n---\nYou review.',
      '.claude/skills/release/SKILL.md': '---\nname: release\ndescription: Cut a release\n---\n',
      '.claude/settings.json': JSON.stringify({
        permissions: { allow: ['Bash(pnpm test:*)', 'Read'], deny: ['Bash(rm -rf:*)'] },
        hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'pnpm lint' }] }], Stop: [] },
      }),
      '.claude/settings.local.json': JSON.stringify({ permissions: { ask: ['WebFetch'] } }),
      '.mcp.json': JSON.stringify({
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github', TOKEN], env: { GITHUB_TOKEN: TOKEN } },
          remote: { type: 'http', url: `https://mcp.example.com/sse?key=${TOKEN}` },
        },
      }),
    });
    const files = await readClaudeFiles(dir);
    expect(files.claudeMd).toBe(true);
    expect(files.claudeLocalMd).toBe(false);
    expect(files.commands).toEqual([
      { name: 'deploy', description: 'Deploy to staging' },
      { name: 'frontend:component', description: null },
    ]);
    expect(files.agents).toEqual([{ name: 'reviewer', description: 'Reviews diffs' }]);
    expect(files.skills).toEqual([{ name: 'release', description: 'Cut a release' }]);
    expect(files.settings).toEqual([
      { file: '.claude/settings.json', allow: ['Bash(pnpm test:*)', 'Read'], deny: ['Bash(rm -rf:*)'], ask: [], hooks: ['PostToolUse', 'Stop'] },
      { file: '.claude/settings.local.json', allow: [], deny: [], ask: ['WebFetch'], hooks: [] },
    ]);
    expect(files.mcpServers).toEqual([
      { name: 'github', type: 'stdio', command: 'npx', argCount: 3, url: null },
      { name: 'remote', type: 'http', command: null, argCount: 0, url: 'https://mcp.example.com' },
    ]);
    expect(files.unreadable).toEqual([]);
    expect(JSON.stringify(files)).not.toContain(TOKEN);
  });

  it('copes with a project without Claude files', async () => {
    dir = await makeTree({ 'package.json': '{}' });
    expect(await readClaudeFiles(dir)).toEqual({
      claudeMd: false,
      claudeLocalMd: false,
      commands: [],
      agents: [],
      skills: [],
      settings: [],
      mcpServers: [],
      unreadable: [],
    });
  });

  it('names files it cannot parse instead of failing', async () => {
    dir = await makeTree({
      '.claude/settings.json': '{ nope',
      '.mcp.json': '[1, 2]',
      '.claude/agents/broken.md': '---\nname: [unclosed\n---\n',
    });
    const files = await readClaudeFiles(dir);
    expect(files.unreadable.sort()).toEqual(['.claude/agents/broken.md', '.claude/settings.json', '.mcp.json']);
    expect(files.agents).toEqual([{ name: 'broken', description: null }]);
  });
});
