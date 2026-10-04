import { lazy } from 'react';
import type { RendererTool } from '../types';
import { DepsCard } from './OverviewCard';

export const depsRendererTool: RendererTool = {
  id: 'deps',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: DepsCard,
  fullHeight: true,
};
