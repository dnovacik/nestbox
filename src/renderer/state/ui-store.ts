import { create } from 'zustand';

export interface UiData {
  selectedProjectId: string | null;
  /** Active tab per project id; 'overview' when unset. */
  activeTab: Record<string, string>;
  filter: string;
  /** Collapsed workspace groups by root project id. */
  collapsed: Record<string, boolean>;
}

export interface UiState extends UiData {
  select(id: string | null): void;
  setActiveTab(projectId: string, tab: string): void;
  setFilter(filter: string): void;
  toggleCollapsed(projectId: string): void;
}

export const initialUiState: UiData = { selectedProjectId: null, activeTab: {}, filter: '', collapsed: {} };

export const useUiStore = create<UiState>()((set) => ({
  ...initialUiState,
  select: (id) => set({ selectedProjectId: id }),
  setActiveTab: (projectId, tab) => set((s) => ({ activeTab: { ...s.activeTab, [projectId]: tab } })),
  setFilter: (filter) => set({ filter }),
  toggleCollapsed: (projectId) =>
    set((s) => ({ collapsed: { ...s.collapsed, [projectId]: !s.collapsed[projectId] } })),
}));
