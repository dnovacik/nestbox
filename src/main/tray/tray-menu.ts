import type { MenuItemConstructorOptions } from 'electron';
import type { ProjectSummary } from '@shared/detected';
import { type AggregateState, aggregateState, belongsTo, type ProcessState, type ProcessSummary } from '@shared/processes';
import type { RunGroup, TrayIconTheme } from '@shared/types';

export interface TrayProcess {
  projectId: string;
  script: string;
  label: string;
  state: ProcessState;
}

export interface TrayProject {
  id: string;
  name: string;
  processes: TrayProcess[];
  runGroups: string[];
}

export interface TrayModel {
  /** Every stored root project, in sidebar order. */
  projects: TrayProject[];
}

export interface TrayActions {
  show(): void;
  quit(): void;
  stop(projectId: string, script: string): void;
  restart(projectId: string, script: string): void;
  showLogs(projectId: string, script: string): void;
  startRunGroup(rootId: string, name: string): void;
  openInEditor(rootId: string): void;
}

/** Processes worth a tray entry: live ones, and crashed ones until the user clears them. */
const shown = (p: ProcessSummary): boolean => p.state !== 'stopped' && p.state !== 'exited';

export function buildTrayModel(
  projects: readonly ProjectSummary[],
  processes: readonly ProcessSummary[],
  runGroups: (rootId: string) => readonly RunGroup[],
): TrayModel {
  return {
    projects: projects.map((project) => {
      const workspaceName = (id: string) => project.detected.workspaces.find((w) => w.id === id)?.name ?? id;
      return {
        id: project.id,
        name: project.name,
        processes: processes
          .filter((p) => belongsTo(p.projectId, project.id) && shown(p))
          .map((p) => ({
            projectId: p.projectId,
            script: p.script,
            state: p.state,
            label: p.projectId === project.id ? p.script : `${workspaceName(p.projectId)} · ${p.script}`,
          })),
        runGroups: runGroups(project.id).map((g) => g.name),
      };
    }),
  };
}

export function buildTrayMenu(model: TrayModel, actions: TrayActions): MenuItemConstructorOptions[] {
  const withProcesses = model.projects.filter((p) => p.processes.length > 0);
  const processItems: MenuItemConstructorOptions[] =
    withProcesses.length === 0
      ? [{ label: 'No scripts running', enabled: false }]
      : withProcesses.map((project) => ({
          label: project.name,
          submenu: project.processes.map((p) => ({
            label: `${p.label} — ${p.state}`,
            submenu: [
              { label: 'Stop', click: () => actions.stop(p.projectId, p.script) },
              { label: 'Restart', click: () => actions.restart(p.projectId, p.script) },
              { label: 'Show logs', click: () => actions.showLogs(p.projectId, p.script) },
            ],
          })),
        }));

  const groups = model.projects.flatMap((project) =>
    project.runGroups.map((name) => ({ label: `${project.name} › ${name}`, click: () => actions.startRunGroup(project.id, name) })),
  );

  return [
    ...processItems,
    { type: 'separator' },
    groups.length === 0 ? { label: 'Run groups', enabled: false } : { label: 'Run groups', submenu: groups },
    model.projects.length === 0
      ? { label: 'Open in VS Code', enabled: false }
      : {
          label: 'Open in VS Code',
          submenu: model.projects.map((p) => ({ label: p.name, click: () => actions.openInEditor(p.id) })),
        },
    { type: 'separator' },
    { label: 'Show Nestbox', click: actions.show },
    { label: 'Quit Nestbox', click: actions.quit },
  ];
}

export function trayTooltip(processes: readonly ProcessSummary[]): string {
  const crashed = processes.filter((p) => p.state === 'crashed').length;
  const running = processes.filter((p) => p.state === 'starting' || p.state === 'running').length;
  const parts = [...(crashed > 0 ? [`${crashed} crashed`] : []), ...(running > 0 ? [`${running} running`] : [])];
  return parts.length === 0 ? 'Nestbox' : `Nestbox: ${parts.join(', ')}`;
}

export type TrayIconSet = 'dark-taskbar' | 'light-taskbar';

export function resolveTrayTheme(setting: TrayIconTheme, systemDark: boolean): TrayIconSet {
  if (setting !== 'auto') return setting;
  return systemDark ? 'dark-taskbar' : 'light-taskbar';
}

/** Paths relative to resources/brand, for brandAsset(). */
export function trayIconPaths(theme: TrayIconSet, state: AggregateState): { x1: string; x2: string } {
  const base = `png/tray/tray-${theme}-${state}`;
  return { x1: `${base}-16.png`, x2: `${base}-32.png` };
}

export function trayState(processes: readonly ProcessSummary[]): AggregateState {
  return aggregateState(processes.map((p) => p.state));
}
