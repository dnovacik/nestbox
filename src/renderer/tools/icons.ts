import { Box, Braces, Container, Database, GitBranch, HeartPulse, Info, KeyRound, LayoutGrid, ListTodo, type LucideIcon, Radar, Server, Sparkles, SquareTerminal } from 'lucide-react';

/** lucide icon names used by ToolDefinition.icon. Adding a tool with a new icon adds a line here. */
const ICONS: Record<string, LucideIcon> = {
  braces: Braces,
  container: Container,
  database: Database,
  'git-branch': GitBranch,
  'heart-pulse': HeartPulse,
  info: Info,
  'key-round': KeyRound,
  'layout-grid': LayoutGrid,
  'list-todo': ListTodo,
  radar: Radar,
  server: Server,
  sparkles: Sparkles,
  terminal: SquareTerminal,
};

export function toolIcon(name: string): LucideIcon {
  return ICONS[name] ?? Box;
}
