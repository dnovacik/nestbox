import { lazy } from 'react';
import type { RendererTool } from '../types';
import { DeployCard } from './OverviewCard';

export const deployRendererTool: RendererTool = {
  id: 'deploy',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: DeployCard,
  fullHeight: true,
};
