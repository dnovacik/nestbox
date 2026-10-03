import { lazy } from 'react';
import type { RendererTool } from '../types';
import { GitCard } from './OverviewCard';

export const gitRendererTool: RendererTool = {
  id: 'git',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: GitCard,
};
