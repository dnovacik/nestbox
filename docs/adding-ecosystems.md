# Adding a New Ecosystem Module

This guide explains how to add support for a new programming language or framework to NestBox's ecosystem system.

## Overview

The ecosystem framework allows NestBox to detect and provide commands for projects in any language or framework. Each ecosystem module:

- Detects projects by examining files in a directory
- Provides a list of runnable tasks (build, test, run, etc.)
- Optionally customizes the runtime environment (PATH, env vars)
- Integrates automatically with the Scripts tool

## Step-by-Step Guide

### 1. Create Your Module File

Create a folder `src/main/ecosystems/<language>/` (e.g. `python/`, `go/`, `rust/`), laid out like `dotnet/` and `node/`:

| File | Holds |
| --- | --- |
| `index.ts` | The module (`<language>Module`): wires the files below into `EcosystemModule` |
| `detect.ts` | The info schema and `detect()` (file names and small capped reads only) |
| `tasks.ts` | `tasks()`: the commands the ecosystem offers |
| `deps.ts`, `sdk.ts`, `env.ts`, … | Optional: dependency checks, toolchain version checks, shared env |
| `__fixtures__/` | Real tool output the tests parse |

Each file has its test next to it (`detect.ts` → `detect.test.ts`). The snippets below show the pieces in one place; split them across the files.

### 2. Define Your Info Schema

Use Zod to define what information your detector captures:

```typescript
import { z } from 'zod';
import type { DetectContext, EcosystemModule } from '../types';

const PythonInfoSchema = z.object({
  // What your detector finds
  hasRequirementsTxt: z.boolean(),
  hasPyprojectToml: z.boolean(),
  venvPath: z.string().nullable(),
  pythonVersion: z.string().nullable(),
});

type PythonInfo = z.infer<typeof PythonInfoSchema>;
```

### 3. Implement the Module

```typescript
export const pythonModule: EcosystemModule<PythonInfo> = {
  // Must match an entry in EcosystemId type (see types.ts)
  id: 'python',
  
  // Your Zod schema
  infoSchema: PythonInfoSchema,

  /**
   * Detect if this directory contains a project of your type.
   * No subprocess and no Electron APIs. Prefer the provided files and dirs sets;
   * read a file only when you must, small and capped (see Cheap Detection).
   * ctx.root holds the project root's file and folder names when dir is a workspace
   * package (null for the root): use it for what a package inherits, like Node's
   * package manager from the root's lockfile.
   */
  async detect(
    dir: string,
    files: ReadonlySet<string>,
    dirs: ReadonlySet<string>,
    ctx?: DetectContext
  ): Promise<PythonInfo | null> {
    // Check for marker files
    if (!files.has('requirements.txt') && !files.has('pyproject.toml')) {
      return null;
    }

    return {
      hasRequirementsTxt: files.has('requirements.txt'),
      hasPyprojectToml: files.has('pyproject.toml'),
      venvPath: dirs.has('.venv') ? '.venv' : null,
      pythonVersion: null, // Can't determine without subprocess
    };
  },

  /**
   * File patterns that make a sub-folder a package when the root declares no workspaces
   * (multi-folder projects): the folder holding a match is the package. Stay one or two
   * levels down, like Node's `*/package.json` and `*/*/package.json`.
   */
  packageGlobs: ['*/pyproject.toml', '*/*/pyproject.toml'],

  /** Optional: folder names that never hold a package (build output, test folders). */
  skipDir: (name) => name === '__pycache__',

  /**
   * Generate the list of runnable tasks for this project.
   * Each task becomes a command in the Scripts tool.
   */
  tasks(info: PythonInfo) {
    const tasks = [];

    // Common Python tasks
    if (info.hasPyprojectToml) {
      tasks.push(
        { name: 'install', argv: ['pip', 'install', '-e', '.'], title: 'Install package' },
        { name: 'build', argv: ['python', '-m', 'build'], title: 'Build' }
      );
    }

    if (info.hasRequirementsTxt) {
      tasks.push({
        name: 'install-deps',
        argv: ['pip', 'install', '-r', 'requirements.txt'],
        title: 'Install dependencies'
      });
    }

    // Always provide test runner
    tasks.push({
      name: 'test',
      argv: ['pytest'],
      title: 'Run tests'
    });

    return tasks;
  },

  /**
   * Customize the runtime environment for every command of the package.
   * Return PATH prepends, env vars, an optional note and warning.
   * ctx.dir is the package folder, ctx.rootDir the project root's for a workspace
   * package (null for a root), ctx.settings what main's runEnvSettings gives your
   * ecosystem (Node: whether the Node tool is on and its fnm switch; {} by default).
   */
  async runEnv(ctx, info: PythonInfo) {
    if (info.venvPath) {
      const binDir = ctx.platform.isWindows
        ? `${info.venvPath}/Scripts`
        : `${info.venvPath}/bin`;

      return {
        pathPrepend: binDir,
        note: `Using ${info.venvPath}`,
      };
    }

    return {}; // No customization needed
  },

  /**
   * One-line summary for the project-info panel.
   * Optional but recommended.
   */
  summary(info: PythonInfo): string | null {
    const parts = ['Python'];
    if (info.pythonVersion) parts.push(info.pythonVersion);
    if (info.venvPath) parts.push(info.venvPath);
    return parts.join(' · ');
  },
};
```

### 4. Add Your Icon (REQUIRED)

Every ecosystem **must** have an icon. Icons are defined in `src/renderer/components/EcosystemIcons.tsx` (renderer process), not in the ecosystem module itself.

**Why?** The main process (where ecosystem modules run) can't use Vite's `?react` imports. Icons must be in the renderer process.

**Steps:**

1. **Find your icon** at https://devicons.github.io/devicon/
2. **Open** `src/renderer/components/EcosystemIcons.tsx`
3. **Import the SVG** at the top with the `?react` suffix:
   ```typescript
   import PythonSvg from 'devicon/icons/python/python-plain.svg?react';
   ```
4. **Add a case** to the `getEcosystemIcon()` switch statement:
   ```typescript
   case 'python':
     return PythonSvg;
   ```

**Use the `-plain.svg` variant** (without wordmark) for best results. Available icons can be browsed at:
- https://devicons.github.io/devicon/
- https://github.com/devicons/devicon/tree/master/icons

**Common icons:**
- Python: `devicon/icons/python/python-plain.svg`
- Node.js: `devicon/icons/nodejs/nodejs-plain.svg`
- .NET: `devicon/icons/dot-net/dot-net-plain.svg`
- Rust: `devicon/icons/rust/rust-plain.svg`
- Go: `devicon/icons/go/go-plain.svg`

Icons appear in:
- Project tree sidebar (next to project names)
- Scripts tool (next to detected tasks)
- Project info panel (ecosystem row)

### 5. Update the EcosystemId Type

Add your language to `src/main/ecosystems/types.ts`:

```typescript
export type EcosystemId = 'python' | 'dotnet' | 'node' | 'rust' | 'go';
```

### 6. Register Your Module

Add it to the registry in `src/main/ecosystems/index.ts`:

```typescript
import { pythonModule } from './python';
import { dotnetModule } from './dotnet';

export const ECOSYSTEM_MODULES: ReadonlyArray<EcosystemModule<unknown, unknown>> = [
  pythonModule,
  dotnetModule,
  // Add yours here
];
```

**Order matters**: Modules are checked in array order. Put more specific detectors before generic ones.

### 7. Write Tests

Create `src/main/ecosystems/<language>/index.test.ts` (and a test next to each other file):

```typescript
import { describe, expect, it } from 'vitest';
import type { PlatformAdapter } from '../../platform/adapter';
import { pythonModule } from './index';

describe('pythonModule', () => {
  describe('detect', () => {
    it('detects requirements.txt projects', async () => {
      const files = new Set(['requirements.txt', 'main.py']);
      const dirs = new Set(['src']);

      const result = await pythonModule.detect('/test/dir', files, dirs);

      expect(result).toEqual({
        hasRequirementsTxt: true,
        hasPyprojectToml: false,
        venvPath: null,
        pythonVersion: null,
      });
    });

    it('returns null for non-Python projects', async () => {
      const files = new Set(['package.json', 'index.js']);
      const dirs = new Set(['src']);

      const result = await pythonModule.detect('/test/dir', files, dirs);

      expect(result).toBeNull();
    });
  });

  describe('tasks', () => {
    it('provides pytest for all projects', () => {
      const info = {
        hasRequirementsTxt: true,
        hasPyprojectToml: false,
        venvPath: null,
        pythonVersion: null,
      };

      const tasks = pythonModule.tasks(info);

      expect(tasks).toContainEqual({
        name: 'test',
        argv: ['pytest'],
        title: 'Run tests',
      });
    });
  });

  describe('runEnv', () => {
    it('adds venv to PATH when present', async () => {
      const info = {
        hasRequirementsTxt: true,
        hasPyprojectToml: false,
        venvPath: '.venv',
        pythonVersion: null,
      };
      const ctx = {
        dir: '/test/dir',
        platform: { isWindows: false } as PlatformAdapter,
        settings: {},
      };

      const env = await pythonModule.runEnv(ctx, info);

      expect(env).toEqual({
        pathPrepend: '.venv/bin',
        note: 'Using .venv',
      });
    });
  });
});
```

### 8. Run Tests and Checks

```bash
pnpm test src/main/ecosystems/<language>
pnpm typecheck
pnpm lint
pnpm test  # Full suite
```

## Design Principles

### Cheap Detection

The `detect()` method must be **cheap**:
- ✅ Check file/dir existence in the provided sets
- ✅ Pattern matching on file names
- ✅ Small, capped reads of a few known files when the names alone don't say enough (the .NET module reads the project file, `launchSettings.json` and `global.json`, each with a size cap)
- ❌ No subprocess execution
- ❌ No Electron APIs
- ❌ Never keep secrets or values (launch profiles' `environmentVariables`, `.env` values)

**Why?** Detection runs for every directory on every refresh. Anything slower (a subprocess, the network) belongs in `runEnv()` or `deps()`.

### Task Design

**Good tasks:**
- Have clear, unique names within the ecosystem
- Use explicit argv (no shell)
- Include a human-readable title
- Work from the project directory

**Examples:**
```typescript
// ✅ Good
{ name: 'test', argv: ['pytest', '--verbose'], title: 'Run tests' }

// ❌ Bad - shell command
{ name: 'test', argv: ['sh', '-c', 'pytest --verbose'], title: 'Run tests' }

// ❌ Bad - unclear name
{ name: 'cmd1', argv: ['pytest'], title: 'Run tests' }
```

### RunEnv vs Detection

- **Detection**: Identifies the project type, captures static metadata
- **RunEnv**: Customizes the runtime environment, can do I/O if needed

If you need to parse a config file or run a subprocess to determine the environment, do it in `runEnv()`, not `detect()`.

## Integration Points

Your module integrates automatically with:

1. **Project detection** (`detectProject()`): Runs during initial scan and rescan
2. **Scripts tool**: Tasks appear as `'detected'` kind commands (Hide on the row, Restore below the list). `runEnv()` applies to them and to custom commands of the package; its `warning` becomes the row's badge.
3. **Project-info**: `summary()` appears in the project card
4. **Workspace detection**: optional `declaredWorkspaces(root)` returns the packages the root's own workspace config declares (Node's npm/pnpm/yarn workspaces; a uv workspace would fit), or null; when any module declares some, sub-folder discovery is skipped. Otherwise `packageGlobs` and `skipDir` find sub-folder packages. Optional `workspaceDirs(root)` always adds folders the root lists itself (a .NET solution's projects). Every folder is checked against the root afterwards (symlinks resolved).
5. **Health** (optional `ports(info)`): the first port is a check suggestion when `.env` has no `PORT`
6. **Dependencies** (optional `deps(info, run, dir)` and `depsUpdateCommand(name, { manager, type })`): the package's rows, through `run` (in `dir`); null when the folder has nothing of its own. A folder in several ecosystems gets one result (Node first, then module order). `depsUpdateCommand` returns null for a row whose manager isn't yours. Network only on Check or the schedule. See `node/deps.ts` and `dotnet/deps.ts`

## Testing Strategy

Test these scenarios:

1. **Detection**
   - Positive cases (marker files present)
   - Negative cases (not this ecosystem)
   - Edge cases (multiple marker files, precedence)

2. **Tasks**
   - Task list matches info
   - Conditional tasks based on detected features
   - All tasks have valid argv and titles

3. **RunEnv**
   - PATH prepending on Windows and Unix
   - Environment variables
   - Notes for user feedback

4. **Summary**
   - Format consistency
   - All info variants

## Examples

See existing modules:
- [`dotnet/`](../src/main/ecosystems/dotnet/) - The full reference: capped reads, solution projects, launch-profile tasks, an SDK warning in `runEnv`, Health ports and a dependency check
- [`node/`](../src/main/ecosystems/node/) - Minimal: detection from file names only (`detect.ts`) and the package manager's commands (`tasks.ts`)
- [`test-module.ts`](../src/main/ecosystems/test-module.ts) - Test fixture showing all features

## Common Patterns

### Multi-Tool Detection

```typescript
async detect(dir, files, dirs) {
  // Check for multiple package managers
  const hasPoetry = files.has('poetry.lock');
  const hasPipenv = files.has('Pipfile');
  const hasUv = files.has('uv.lock');

  if (!hasPoetry && !hasPipenv && !hasUv && !files.has('requirements.txt')) {
    return null;
  }

  return { hasPoetry, hasPipenv, hasUv, ... };
}
```

### Conditional Tasks

```typescript
tasks(info) {
  const tasks = [];

  // Tool-specific tasks
  if (info.hasPoetry) {
    tasks.push({ name: 'poetry-install', argv: ['poetry', 'install'], title: 'Install with Poetry' });
  }
  if (info.hasPipenv) {
    tasks.push({ name: 'pipenv-install', argv: ['pipenv', 'install'], title: 'Install with Pipenv' });
  }

  // Universal tasks
  tasks.push({ name: 'test', argv: ['pytest'], title: 'Run tests' });

  return tasks;
}
```

### Platform-Specific Paths

```typescript
async runEnv(ctx, info) {
  if (!info.venvPath) return {};

  const binDir = ctx.platform.isWindows
    ? `${info.venvPath}\\Scripts`
    : `${info.venvPath}/bin`;

  return { pathPrepend: binDir };
}
```

## Troubleshooting

**Module not detecting**: Check the order in `ECOSYSTEM_MODULES`. Earlier modules shadow later ones.

**Tasks not appearing**: Verify the module is registered and `tasks()` returns valid `DetectedTask` objects with `name`, `argv`, and `title`.

**PATH not working**: Check platform-specific path separators in `runEnv()`.

**Tests failing**: Ensure you're not using `any` types and all unused parameters are prefixed with `_`.

## Questions?

Check the [ecosystem spec](superpowers/specs/2026-10-07-nestbox-v2-ecosystems-plan.md) for design rationale, or look at the `.NET` module (`src/main/ecosystems/dotnet/`) as a reference implementation.
