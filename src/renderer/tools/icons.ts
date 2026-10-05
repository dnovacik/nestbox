import { Box, Braces, Container, Database, GitBranch, HeartPulse, Hexagon, Info, KeyRound, LayoutGrid, ListTodo, type LucideIcon, Package, Radar, Rocket, Server, Sparkles, SquareTerminal, Workflow } from 'lucide-react';

/** lucide icon names used by ToolDefinition.icon. Adding a tool with a new icon adds a line here. */
const ICONS: Record<string, LucideIcon> = {
  braces: Braces,
  container: Container,
  database: Database,
  'git-branch': GitBranch,
  'heart-pulse': HeartPulse,
  hexagon: Hexagon,
  info: Info,
  'key-round': KeyRound,
  'layout-grid': LayoutGrid,
  'list-todo': ListTodo,
  package: Package,
  radar: Radar,
  rocket: Rocket,
  server: Server,
  sparkles: Sparkles,
  terminal: SquareTerminal,
  workflow: Workflow,
};

export function toolIcon(name: string): LucideIcon {
  return ICONS[name] ?? Box;
}
