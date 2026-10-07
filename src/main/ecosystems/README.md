# Ecosystem Modules

This directory contains ecosystem modules that detect and provide commands for different programming languages and frameworks.

## Current Modules

- **dotnet** - .NET projects (.sln, .csproj, .fsproj)
- **node** - Node.js projects (package.json)

## Adding a New Module

See [docs/adding-ecosystems.md](../../docs/adding-ecosystems.md) for a complete guide.

**Quick start:**

1. Create `<language>.ts` with detection logic and task list
2. Add your ecosystem ID to `EcosystemId` in `types.ts`
3. **Add your icon** - Update `src/renderer/components/EcosystemIcons.tsx` (required)
4. Register in `index.ts` → `ECOSYSTEM_MODULES` array
5. Add tests in `<language>.test.ts`
6. Run `pnpm test` and `pnpm lint`

**Template:**

```typescript
import { z } from 'zod';
import type { EcosystemModule } from './types';

const MyInfoSchema = z.object({
  // What you detect
});

export const myModule: EcosystemModule<z.infer<typeof MyInfoSchema>> = {
  id: 'my-language',
  infoSchema: MyInfoSchema,
  
  async detect(dir, files, dirs) {
    // Return info or null
  },
  
  packageGlobs: ['**/marker-file'],
  
  tasks(info) {
    return [
      { name: 'build', argv: ['my-cli', 'build'], title: 'Build' },
    ];
  },
  
  async runEnv(ctx, info) {
    return {}; // or { pathPrepend, env, note }
  },
  
  summary(info) {
    return 'My Language';
  },
};
```

## Icons (REQUIRED)

Every ecosystem **must** have an icon. Icons are defined in `src/renderer/components/EcosystemIcons.tsx` (renderer process), not in the ecosystem module itself.

**How to add an icon:**

1. Find your language/framework at https://devicons.github.io/devicon/
2. Open `src/renderer/components/EcosystemIcons.tsx`
3. Import the SVG with `?react` suffix: `import MySvg from 'devicon/icons/name/name-plain.svg?react';`
4. Add a case to the `getEcosystemIcon()` switch statement:
   ```typescript
   case 'my-language':
     return MySvg;
   ```

**Why icons are in the renderer:**
The main process (where ecosystem modules run) can't use Vite's `?react` imports. Icons must be defined in the renderer process.

**Available icons:**
- .NET: `devicon/icons/dot-net/dot-net-plain.svg`
- Node.js: `devicon/icons/nodejs/nodejs-plain.svg`
- Python: `devicon/icons/python/python-plain.svg`
- Browse more: https://devicons.github.io/devicon/

Icons appear in:
- Project tree (next to project names)
- Scripts tool (next to detected tasks)
- Project info panel (ecosystem row)

## Module Order

Modules in `ECOSYSTEM_MODULES` are checked in order. Put more specific detectors before generic ones.

## Key Constraints

- **detect()** must be pure (no I/O, no subprocess)
- **tasks()** must return valid DetectedTask[] with name, argv, title
- **Module IDs** must match the EcosystemId union type
- **Icon** is REQUIRED - must be added to EcosystemIcons.tsx in renderer
- **Tests** should cover detection, tasks, runEnv, and summary

## Integration

Modules integrate automatically with:
- Project detection and scanning
- Scripts tool (tasks appear as 'detected' kind)
- Project-info panel (via summary())
- Workspace detection (via packageGlobs)
- Icons (displayed from EcosystemIcons.tsx)
