import { lazy } from 'react';
import type { RendererTool } from '../types';
import { CiCard } from './OverviewCard';

export const ciRendererTool: RendererTool = {
  id: 'ci',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: CiCard,
  fullHeight: true,
};
