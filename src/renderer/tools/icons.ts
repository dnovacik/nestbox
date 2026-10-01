import { Box, Info, LayoutGrid, type LucideIcon } from 'lucide-react';

/** lucide icon names used by ToolDefinition.icon. Adding a tool with a new icon adds a line here. */
const ICONS: Record<string, LucideIcon> = {
  info: Info,
  'layout-grid': LayoutGrid,
};

export function toolIcon(name: string): LucideIcon {
  return ICONS[name] ?? Box;
}
