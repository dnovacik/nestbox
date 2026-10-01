import { Box, Info, LayoutGrid } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { toolDefinitions } from '@shared/tools';
import { toolIcon } from './icons';

describe('toolIcon', () => {
  it('maps known names and falls back to Box', () => {
    expect(toolIcon('info')).toBe(Info);
    expect(toolIcon('layout-grid')).toBe(LayoutGrid);
    expect(toolIcon('nope')).toBe(Box);
  });

  it('has an icon for every registered tool', () => {
    for (const def of toolDefinitions) expect(toolIcon(def.icon)).not.toBe(Box);
  });
});
