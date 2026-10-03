import { lazy } from 'react';
import type { RendererTool } from '../types';
import { DatabaseCard } from './OverviewCard';

export const databaseRendererTool: RendererTool = {
  id: 'database',
  Panel: lazy(() => import('./Panel')),
  OverviewCard: DatabaseCard,
  fullHeight: true,
};
