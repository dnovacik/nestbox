import { Box, Database, GitBranch, Info, KeyRound, LayoutGrid, type LucideIcon, Server, Sparkles, SquareTerminal } from 'lucide-react';

/** lucide icon names used by ToolDefinition.icon. Adding a tool with a new icon adds a line here. */
const ICONS: Record<string, LucideIcon> = {
  database: Database,
  'git-branch': GitBranch,
  info: Info,
  'key-round': KeyRound,
  'layout-grid': LayoutGrid,
  server: Server,
  sparkles: Sparkles,
  terminal: SquareTerminal,
};

export function toolIcon(name: string): LucideIcon {
  return ICONS[name] ?? Box;
}
