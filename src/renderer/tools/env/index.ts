import { lazy } from 'react';
import type { RendererTool } from '../types';
import { EnvCard } from './OverviewCard';

export const envRendererTool: RendererTool = {
  id: 'env',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: EnvCard,
};
