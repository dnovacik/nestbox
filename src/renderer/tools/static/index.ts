import { lazy } from 'react';
import type { RendererTool } from '../types';
import { StaticCard } from './OverviewCard';

export const staticRendererTool: RendererTool = {
  id: 'static',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: StaticCard,
  fullHeight: true,
};
