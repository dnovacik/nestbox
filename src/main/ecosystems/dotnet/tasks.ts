import type { DetectedTask } from '../types';
import type { DotnetInfo } from './detect';

/** A task name for a launch profile: `run:<profile>`, within COMMAND_NAME (60 characters, no spaces). */
export function profileTaskName(profile: string): string {
  return `run:${profile.replace(/[^A-Za-z0-9._-]+/g, '-')}`.slice(0, 60);
}

/**
 * dotnet's own commands for a folder. A project runs (and watches) through its project file; build,
 * restore and clean take the solution when the folder has one; test runs for a solution or a test project.
 */
export function dotnetTasks(info: DotnetInfo): DetectedTask[] {
  const tasks: DetectedTask[] = [];
  const { project, solution } = info;
  if (project !== null && !info.isTest) {
    tasks.push({ name: 'run', argv: ['dotnet', 'run', '--project', project], title: 'Run' });
    tasks.push({ name: 'watch', argv: ['dotnet', 'watch', '--project', project], title: 'Run with hot reload' });
    const taken = new Set(['run']);
    for (const profile of info.launchProfiles) {
      const name = profileTaskName(profile.name);
      if (taken.has(name)) continue;
      taken.add(name);
      tasks.push({
        name,
        argv: ['dotnet', 'run', '--project', project, '--launch-profile', profile.name],
        title: `Run (${profile.name} profile)`,
      });
    }
  }
  const target = solution ?? project;
  if (target === null) return tasks;
  tasks.push({ name: 'build', argv: ['dotnet', 'build', target], title: 'Build' });
  if (solution !== null || info.isTest)
    tasks.push({ name: 'test', argv: ['dotnet', 'test', target], title: 'Test' });
  tasks.push({ name: 'restore', argv: ['dotnet', 'restore', target], title: 'Restore packages' });
  tasks.push({ name: 'clean', argv: ['dotnet', 'clean', target], title: 'Clean' });
  return tasks;
}
