import { describe, expect, it } from 'vitest';
import { parseSln } from './parse-sln';

describe('parseSln', () => {
  it('parses a valid solution with multiple projects', () => {
    const content = `
Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApi", "src\\WebApi\\WebApi.csproj", "{12345678-1234-1234-1234-123456789ABC}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Core", "src\\Core\\Core.csproj", "{87654321-4321-4321-4321-CBA987654321}"
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Tests", "tests\\Tests\\Tests.csproj", "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
		Release|Any CPU = Release|Any CPU
	EndGlobalSection
EndGlobal
`;

    const result = parseSln(content);

    expect(result).toEqual([
      { name: 'WebApi', path: 'src\\WebApi\\WebApi.csproj' },
      { name: 'Core', path: 'src\\Core\\Core.csproj' },
      { name: 'Tests', path: 'tests\\Tests\\Tests.csproj' },
    ]);
  });

  it('parses F# projects', () => {
    const content = `
Project("{F2A71F9B-5D33-465A-A702-920D77279786}") = "MyFSharpProject", "src\\MyFSharpProject.fsproj", "{12345678-1234-1234-1234-123456789ABC}"
EndProject
`;

    const result = parseSln(content);

    expect(result).toEqual([{ name: 'MyFSharpProject', path: 'src\\MyFSharpProject.fsproj' }]);
  });

  it('parses VB.NET projects', () => {
    const content = `
Project("{F184B08F-C81C-45F6-A57F-5ABD9991F28F}") = "MyVBProject", "src\\MyVBProject.vbproj", "{12345678-1234-1234-1234-123456789ABC}"
EndProject
`;

    const result = parseSln(content);

    expect(result).toEqual([{ name: 'MyVBProject', path: 'src\\MyVBProject.vbproj' }]);
  });

  it('handles forward slashes in paths', () => {
    const content = `
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApi", "src/WebApi/WebApi.csproj", "{12345678-1234-1234-1234-123456789ABC}"
EndProject
`;

    const result = parseSln(content);

    expect(result).toEqual([{ name: 'WebApi', path: 'src/WebApi/WebApi.csproj' }]);
  });

  it('ignores solution folders and non-project entries', () => {
    const content = `
Project("{2150E333-8FDC-42A3-9474-1A3956D46DE8}") = "Solution Items", "Solution Items", "{FOLDER-GUID}"
	ProjectSection(SolutionItems) = preProject
		README.md = README.md
	EndProjectSection
EndProject
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApi", "src\\WebApi\\WebApi.csproj", "{12345678-1234-1234-1234-123456789ABC}"
EndProject
`;

    const result = parseSln(content);

    expect(result).toEqual([{ name: 'WebApi', path: 'src\\WebApi\\WebApi.csproj' }]);
  });

  it('returns null for empty solution', () => {
    const content = `
Microsoft Visual Studio Solution File, Format Version 12.00
Global
EndGlobal
`;

    const result = parseSln(content);

    expect(result).toBeNull();
  });

  it('returns null for invalid content', () => {
    const result = parseSln('not a solution file');

    expect(result).toBeNull();
  });

  it('handles projects with spaces in names', () => {
    const content = `
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "My Web Api", "src\\My Web Api\\My Web Api.csproj", "{12345678-1234-1234-1234-123456789ABC}"
EndProject
`;

    const result = parseSln(content);

    expect(result).toEqual([{ name: 'My Web Api', path: 'src\\My Web Api\\My Web Api.csproj' }]);
  });

  it('handles Windows line endings', () => {
    const content = [
      'Microsoft Visual Studio Solution File, Format Version 12.00',
      'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "WebApi", "src\\WebApi\\WebApi.csproj", "{12345678-1234-1234-1234-123456789ABC}"',
      'EndProject',
    ].join('\r\n');

    const result = parseSln(content);

    expect(result).toEqual([{ name: 'WebApi', path: 'src\\WebApi\\WebApi.csproj' }]);
  });
});
