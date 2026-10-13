import { afterEach, describe, expect, it } from 'vitest';
import { makeTree, removeTree } from '../../detection/test-fixtures';
import { detectDotnet, parseGlobalJson, parseLaunchSettings, parseProjectFile } from './detect';

let dir = '';
afterEach(async () => removeTree(dir));

// As `dotnet new webapi` (SDK 10.0.401) writes them.
const WEB_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk.Web">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" Version="10.0.12" />
  </ItemGroup>

</Project>`;
const LAUNCH_SETTINGS = `\uFEFF{
  "$schema": "https://json.schemastore.org/launchsettings.json",
  "profiles": {
    "http": {
      "commandName": "Project",
      "applicationUrl": "http://localhost:5283",
      "environmentVariables": { "ASPNETCORE_ENVIRONMENT": "Development", "API_KEY": "secret" }
    },
    "https": {
      "commandName": "Project",
      "applicationUrl": "https://localhost:7031;http://localhost:5283"
    },
    "IIS Express": { "commandName": "IISExpress" },
    "bad\\"name": { "commandName": "Project" }
  }
}`;

describe('parseProjectFile', () => {
  it('notes the EF Core Design package', () => {
    const xml =
      '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup>' +
      '<PackageReference Include="Microsoft.EntityFrameworkCore.Design" Version="10.0.0" />' +
      '</ItemGroup></Project>';
    expect(parseProjectFile(xml).efDesign).toBe(true);
    expect(parseProjectFile('<Project Sdk="Microsoft.NET.Sdk" />').efDesign).toBe(false);
  });

  it('reads the web SDK and target framework', () => {
    expect(parseProjectFile(WEB_CSPROJ)).toEqual({
      targetFrameworks: ['net10.0'],
      isWeb: true,
      isTest: false,
      dbProviders: [],
      efDesign: false,
    });
  });

  it('reads several target frameworks and ignores comments', () => {
    const xml =
      '<Project Sdk="Microsoft.NET.Sdk"><!-- <TargetFramework>net6.0</TargetFramework> -->' +
      '<PropertyGroup><TargetFrameworks>net8.0;net48</TargetFrameworks></PropertyGroup></Project>';
    expect(parseProjectFile(xml)).toEqual({
      targetFrameworks: ['net8.0', 'net48'],
      isWeb: false,
      isTest: false,
      dbProviders: [],
      efDesign: false,
    });
  });

  it.each([
    '<PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />',
    '<PackageReference Include="xunit" Version="2.9.3" />',
    '<PackageReference Include="NUnit" Version="4.0.0" />',
    '<IsTestProject>true</IsTestProject>',
  ])('recognises a test project from %s', (snippet) => {
    expect(
      parseProjectFile(
        `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup>${snippet}</ItemGroup></Project>`,
      ).isTest,
    ).toBe(true);
  });

  it('keeps the database providers the project references, never commented-out ones', () => {
    const xml = `<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup>
      <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.0" />
      <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.0" />
      <PackageReference Include="Npgsql" Version="10.0.0" />
      <!-- <PackageReference Include="MySqlConnector" Version="2.4.0" /> -->
      <PackageReference Include="Serilog" Version="4.0.0" />
    </ItemGroup></Project>`;
    expect(parseProjectFile(xml).dbProviders).toEqual(['postgresql', 'sqlite']);
    const each = (pkg: string) =>
      parseProjectFile(`<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="${pkg}" Version="1.0.0" /></ItemGroup></Project>`).dbProviders;
    expect(each('Microsoft.Data.SqlClient')).toEqual(['sqlserver']);
    expect(each('System.Data.SqlClient')).toEqual(['sqlserver']);
    expect(each('Microsoft.EntityFrameworkCore.SqlServer')).toEqual(['sqlserver']);
    expect(each('Microsoft.Data.Sqlite.Core')).toEqual(['sqlite']);
    expect(each('System.Data.SQLite')).toEqual(['sqlite']);
    expect(each('Pomelo.EntityFrameworkCore.MySql')).toEqual(['mysql']);
    expect(each('MySql.Data')).toEqual(['mysql']);
    expect(each('MongoDB.Driver')).toEqual(['mongodb']);
    expect(each('Microsoft.EntityFrameworkCore')).toEqual([]);
  });

  it('recognises the MSTest SDK', () => {
    expect(parseProjectFile('<Project Sdk="MSTest.Sdk/3.6.0"></Project>').isTest).toBe(true);
  });
});

describe('parseLaunchSettings', () => {
  it('keeps Project profiles with safe names and their http ports, never their variables', () => {
    const profiles = parseLaunchSettings(LAUNCH_SETTINGS);
    expect(profiles).toEqual([
      { name: 'http', ports: [5283], environment: 'Development' },
      { name: 'https', ports: [5283], environment: 'Production' },
    ]);
    expect(JSON.stringify(profiles)).not.toContain('secret');
  });

  it('takes the environment from ASPNETCORE_ENVIRONMENT, else DOTNET_ENVIRONMENT, else Production', () => {
    const profile = (vars: Record<string, string>) =>
      JSON.stringify({ profiles: { p: { commandName: 'Project', environmentVariables: vars } } });
    const env = (vars: Record<string, string>) => parseLaunchSettings(profile(vars))[0]?.environment;
    expect(env({ DOTNET_ENVIRONMENT: 'Staging', ASPNETCORE_ENVIRONMENT: 'Local' })).toBe('Local');
    expect(env({ DOTNET_ENVIRONMENT: 'Staging' })).toBe('Staging');
    expect(env({ ASPNETCORE_ENVIRONMENT: 'has space' })).toBe('Production');
    expect(env({ ASPNETCORE_ENVIRONMENT: '../x' })).toBe('Production');
    expect(env({})).toBe('Production');
    expect(JSON.stringify(parseLaunchSettings(profile({ ASPNETCORE_ENVIRONMENT: 'Dev', TOKEN: 'secret' })))).not.toContain('secret');
  });

  it('returns [] for missing or invalid files', () => {
    expect(parseLaunchSettings(null)).toEqual([]);
    expect(parseLaunchSettings('{ nope')).toEqual([]);
    expect(parseLaunchSettings('{"profiles": []}')).toEqual([]);
  });
});

describe('parseGlobalJson', () => {
  it('reads the SDK version and roll-forward policy, latestPatch by default', () => {
    expect(parseGlobalJson('{"sdk":{"version":"8.0.100","rollForward":"latestFeature"}}')).toEqual({
      version: '8.0.100',
      rollForward: 'latestFeature',
    });
    expect(parseGlobalJson('{"sdk":{"version":"9.0.100-rc.1.24452.12"}}')).toEqual({
      version: '9.0.100-rc.1.24452.12',
      rollForward: 'latestPatch',
    });
  });

  it('ignores files without a valid version', () => {
    expect(parseGlobalJson('{"msbuild-sdks":{}}')).toBeNull();
    expect(parseGlobalJson('{"sdk":{"version":"8.0 & calc"}}')).toBeNull();
    expect(parseGlobalJson(null)).toBeNull();
  });
});

describe('detectDotnet', () => {
  it('returns null without a solution or project file', async () => {
    dir = await makeTree({ 'package.json': '{}' });
    expect(await detectDotnet(dir, new Set(['package.json']))).toBeNull();
  });

  it('reads a web project, its launch profiles and the global.json above it', async () => {
    dir = await makeTree({
      'global.json': '{"sdk":{"version":"10.0.100"}}',
      'src/Api/Api.csproj': WEB_CSPROJ,
      'src/Api/Properties/launchSettings.json': LAUNCH_SETTINGS,
    });
    expect(await detectDotnet(`${dir}/src/Api`, new Set(['Api.csproj', 'Program.cs']))).toEqual({
      solution: null,
      project: 'Api.csproj',
      targetFrameworks: ['net10.0'],
      isWeb: true,
      isTest: false,
      dbProviders: [],
      efDesign: false,
      sdk: { version: '10.0.100', rollForward: 'latestPatch' },
      launchProfiles: [
        { name: 'http', ports: [5283], environment: 'Development' },
        { name: 'https', ports: [5283], environment: 'Production' },
      ],
    });
  });

  it('takes the first solution and project by name', async () => {
    dir = await makeTree({
      'B.slnx': '<Solution />',
      'A.sln': '',
      'Z.csproj': '<Project />',
      'Y.fsproj': '<Project />',
    });
    const info = await detectDotnet(dir, new Set(['B.slnx', 'A.sln', 'Z.csproj', 'Y.fsproj']));
    expect(info).toMatchObject({ solution: 'A.sln', project: 'Y.fsproj' });
  });
});
