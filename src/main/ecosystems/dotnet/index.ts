import { z } from 'zod';
import type { EcosystemModule } from './types';

/**
 * .NET project info: the solution/project file, target framework, and whether it's
 * a web project (has Microsoft.NET.Sdk.Web or known web NuGet packages).
 */
const DotnetInfoSchema = z.object({
  /** Path to .sln or .csproj/.fsproj file, relative to project root */
  projectFile: z.string(),
  /** Target framework (e.g., "net8.0", "net6.0") or null if not detected */
  targetFramework: z.string().nullable(),
  /** Whether this is a web project (ASP.NET Core, etc.) */
  isWeb: z.boolean(),
});
export type DotnetInfo = z.infer<typeof DotnetInfoSchema>;

/**
 * .NET ecosystem module: detects .NET projects via .sln, .csproj, or .fsproj files
 * and provides standard dotnet commands (restore, build, run, test, etc.).
 */
export const dotnetModule: EcosystemModule<DotnetInfo> = {
  id: 'dotnet',
  infoSchema: DotnetInfoSchema,

  /**
   * Detect .NET projects by looking for solution or project files.
   * Solution files (.sln) take precedence over project files.
   */
  async detect(_dir: string, files: ReadonlySet<string>, _dirs: ReadonlySet<string>): Promise<DotnetInfo | null> {
    // Look for .sln files first
    const slnFile = Array.from(files).find(f => f.endsWith('.sln'));
    if (slnFile) {
      return {
        projectFile: slnFile,
        targetFramework: null, // We can't easily parse without file I/O
        isWeb: false, // Solutions don't have this metadata
      };
    }

    // Look for .csproj or .fsproj files
    const projectFile = Array.from(files).find(f => f.endsWith('.csproj') || f.endsWith('.fsproj'));
    if (projectFile) {
      return {
        projectFile,
        targetFramework: null, // Would need file I/O to parse
        isWeb: false, // Would need file I/O to detect
      };
    }

    return null;
  },

  /**
   * Glob patterns for finding workspace packages in a .NET solution.
   * .NET projects can be in subdirectories.
   */
  packageGlobs: ['**/*.csproj', '**/*.fsproj', '**/*.sln'],

  /**
   * Provide standard .NET tasks based on the project type.
   * All projects get 'restore', 'build', 'test', 'clean', and 'run'.
   */
  tasks(info: DotnetInfo) {
    const tasks = [
      { name: 'run', argv: ['dotnet', 'run', '--project', info.projectFile], title: 'Run' },
      { name: 'build', argv: ['dotnet', 'build', info.projectFile], title: 'Build' },
      { name: 'test', argv: ['dotnet', 'test', info.projectFile], title: 'Test' },
      { name: 'restore', argv: ['dotnet', 'restore', info.projectFile], title: 'Restore packages' },
      { name: 'clean', argv: ['dotnet', 'clean', info.projectFile], title: 'Clean' },
    ];

    return tasks;
  },

  /**
   * Provide run environment for .NET tasks.
   * No special environment needed - dotnet CLI is expected to be in PATH.
   */
  async runEnv(_ctx, _info: DotnetInfo) {
    return {};
  },

  /**
   * One-line summary for project-info display.
   */
  summary(info: DotnetInfo): string | null {
    const parts = ['.NET'];
    if (info.targetFramework) parts.push(info.targetFramework);
    if (info.isWeb) parts.push('Web');
    return parts.join(' · ');
  },
};
