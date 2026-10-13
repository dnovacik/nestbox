import { describe, expect, it } from 'vitest';
import type { DotnetInfo } from './detect';
import { dotnetTasks } from './tasks';

const info = (over: Partial<DotnetInfo> = {}): DotnetInfo => ({
  solution: null,
  project: 'Api.csproj',
  targetFrameworks: ['net8.0'],
  isWeb: true,
  isTest: false,
  dbProviders: [],
  efDesign: false,
  sdk: null,
  launchProfiles: [],
  ...over,
});

describe('dotnetTasks', () => {
  it('runs, watches, builds, restores and cleans a project, plus one run per launch profile', () => {
    const tasks = dotnetTasks(
      info({
        launchProfiles: [
          { name: 'http', ports: [5283], environment: 'Production' },
          { name: 'IIS Profile 2', ports: [], environment: 'Production' },
        ],
      }),
    );
    expect(tasks.map((t) => [t.name, t.argv.join(' ')])).toEqual([
      ['run', 'dotnet run --project Api.csproj'],
      ['watch', 'dotnet watch --project Api.csproj'],
      ['run:http', 'dotnet run --project Api.csproj --launch-profile http'],
      ['run:IIS-Profile-2', 'dotnet run --project Api.csproj --launch-profile IIS Profile 2'],
      ['build', 'dotnet build Api.csproj'],
      ['restore', 'dotnet restore Api.csproj'],
      ['clean', 'dotnet clean Api.csproj'],
    ]);
  });

  it('tests a test project instead of running it', () => {
    const names = dotnetTasks(
      info({ project: 'Api.Tests.csproj', isTest: true, isWeb: false }),
    ).map((t) => t.name);
    expect(names).toEqual(['build', 'test', 'restore', 'clean']);
  });

  it('builds and tests the solution of a solution-only folder', () => {
    const tasks = dotnetTasks(info({ solution: 'Shop.slnx', project: null }));
    expect(tasks.map((t) => t.argv.join(' '))).toEqual([
      'dotnet build Shop.slnx',
      'dotnet test Shop.slnx',
      'dotnet restore Shop.slnx',
      'dotnet clean Shop.slnx',
    ]);
  });

  it('runs the project but builds the solution when a folder has both', () => {
    const tasks = dotnetTasks(info({ solution: 'Shop.sln' }));
    expect(tasks.find((t) => t.name === 'run')?.argv).toEqual([
      'dotnet',
      'run',
      '--project',
      'Api.csproj',
    ]);
    expect(tasks.find((t) => t.name === 'build')?.argv).toEqual(['dotnet', 'build', 'Shop.sln']);
  });
});
