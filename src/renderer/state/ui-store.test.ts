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

describe('script panes', () => {
  it('fills the active pane and splits into two', () => {
    const s = () => useUiStore.getState();
    s().showScript('p1', 'dev');
    expect(s().scriptPanes['p1']).toEqual({ scripts: ['dev'], active: 0 });
    s().toggleSplit('p1');
    expect(s().scriptPanes['p1']).toEqual({ scripts: ['dev', null], active: 1 });
    s().showScript('p1', 'api');
    expect(s().scriptPanes['p1']?.scripts).toEqual(['dev', 'api']);
    s().setActivePane('p1', 0);
    s().showScript('p1', 'build');
    expect(s().scriptPanes['p1']?.scripts).toEqual(['build', 'api']);
    s().setPaneScript('p1', 1, 'web');
    expect(s().scriptPanes['p1']).toEqual({ scripts: ['build', 'web'], active: 1 });
    s().toggleSplit('p1');
    expect(s().scriptPanes['p1']).toEqual({ scripts: ['build'], active: 0 });
  });
});
