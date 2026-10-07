import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findWorkspaceDirs } from './workspaces';

describe('findWorkspaceDirs with .sln files', () => {
  const tmpRoot = join(__dirname, '__test_sln_workspaces__');

  beforeEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    await mkdir(tmpRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('detects workspace packages from a .sln file', async () => {
    // Create a .sln file
    const slnContent = `
Microsoft Visual Studio Solution File, Format Version 12.00
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApi", "src\\WebApi\\WebApi.csproj", "{12345678-1234-1234-1234-123456789ABC}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "src\\Core\\Core.csproj", "{87654321-4321-4321-4321-CBA987654321}"
EndProject
Global
EndGlobal
`;
    await writeFile(join(tmpRoot, 'MySolution.sln'), slnContent, 'utf8');

    // Create the project directories with package.json
    await mkdir(join(tmpRoot, 'src', 'WebApi'), { recursive: true });
    await mkdir(join(tmpRoot, 'src', 'Core'), { recursive: true });
    await writeFile(join(tmpRoot, 'src', 'WebApi', 'package.json'), '{}', 'utf8');
    await writeFile(join(tmpRoot, 'src', 'Core', 'package.json'), '{}', 'utf8');

    const result = await findWorkspaceDirs(tmpRoot, null);

    expect(result.sort()).toEqual(['src/Core', 'src/WebApi']);
  });

  it('handles .sln files with forward slashes', async () => {
    const slnContent = `
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApi", "src/WebApi/WebApi.csproj", "{12345678-1234-1234-1234-123456789ABC}"
EndProject
`;
    await writeFile(join(tmpRoot, 'MySolution.sln'), slnContent, 'utf8');

    await mkdir(join(tmpRoot, 'src', 'WebApi'), { recursive: true });
    await writeFile(join(tmpRoot, 'src', 'WebApi', 'package.json'), '{}', 'utf8');

    const result = await findWorkspaceDirs(tmpRoot, null);

    expect(result).toEqual(['src/WebApi']);
  });

  it('combines .sln and pnpm-workspace packages', async () => {
    // Create .sln
    const slnContent = `
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApi", "src\\WebApi\\WebApi.csproj", "{12345678-1234-1234-1234-123456789ABC}"
EndProject
`;
    await writeFile(join(tmpRoot, 'MySolution.sln'), slnContent, 'utf8');

    // Create pnpm-workspace.yaml
    const pnpmContent = `packages:
  - tools/*
`;
    await writeFile(join(tmpRoot, 'pnpm-workspace.yaml'), pnpmContent, 'utf8');

    // Create directories
    await mkdir(join(tmpRoot, 'src', 'WebApi'), { recursive: true });
    await mkdir(join(tmpRoot, 'tools', 'cli'), { recursive: true });
    await writeFile(join(tmpRoot, 'src', 'WebApi', 'package.json'), '{}', 'utf8');
    await writeFile(join(tmpRoot, 'tools', 'cli', 'package.json'), '{}', 'utf8');

    const result = await findWorkspaceDirs(tmpRoot, null);

    expect(result.sort()).toEqual(['src/WebApi', 'tools/cli']);
  });

  it('ignores invalid .sln files', async () => {
    await writeFile(join(tmpRoot, 'Invalid.sln'), 'not a valid solution', 'utf8');

    const warnings: string[] = [];
    const result = await findWorkspaceDirs(tmpRoot, null, {
      onWarning: (file, reason) => warnings.push(`${file}:${reason}`),
    });

    expect(result).toEqual([]);
    expect(warnings).toContain('Invalid.sln:invalid-sln');
  });
});
