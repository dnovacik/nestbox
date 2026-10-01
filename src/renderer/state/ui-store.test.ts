import { describe, expect, it } from 'vitest';
import { useUiStore } from './ui-store';

describe('ui store', () => {
  it('tracks selection, tabs per project, filter and collapsed groups', () => {
    const s = useUiStore.getState();
    s.select('p1');
    s.setActiveTab('p1', 'project-info');
    s.setFilter('sho');
    s.toggleCollapsed('p1');
    expect(useUiStore.getState()).toMatchObject({
      selectedProjectId: 'p1',
      activeTab: { p1: 'project-info' },
      filter: 'sho',
      collapsed: { p1: true },
    });
    useUiStore.getState().toggleCollapsed('p1');
    expect(useUiStore.getState().collapsed['p1']).toBe(false);
  });
});
