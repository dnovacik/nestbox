import { lazy } from 'react';
import type { RendererTool } from '../types';
import { ClaudeCard } from './OverviewCard';

export const claudeRendererTool: RendererTool = {
  id: 'claude',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: ClaudeCard,
  fullHeight: true,
};
