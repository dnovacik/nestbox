import { describe, expect, it } from 'vitest';
import { isTestName, parseSolution } from './solution';

const project = (type: string, name: string, path: string) =>
  `Project("{${type}}") = "${name}", "${path}", "{12345678-1234-1234-1234-123456789ABC}"\r\nEndProject\r\n`;
const CS = 'FAE04EC0-301F-11D3-BF4B-00C04F79EFBC';
const FOLDER = '2150E333-8FDC-42A3-9474-1A3956D46DE8';

describe('parseSolution', () => {
  it('reads C#, F# and VB projects from an .sln, with / separators', () => {
    const text =
      '\uFEFF\r\nMicrosoft Visual Studio Solution File, Format Version 12.00\r\n' +
      project(CS, 'Api', 'src\\Api\\Api.csproj') +
      project('F2A71F9B-5D33-465A-A702-920D77279786', 'Lib', 'src/Lib/Lib.fsproj') +
      project('F184B08F-C81C-45F6-A57F-5ABD9991F28F', 'Legacy', 'Legacy\\Legacy.vbproj') +
      project(CS, 'My Web Api', 'src\\My Web Api\\My Web Api.csproj') +
      'Global\r\nEndGlobal\r\n';
    expect(parseSolution('Shop.sln', text)).toEqual([
      'src/Api/Api.csproj',
      'src/Lib/Lib.fsproj',
      'Legacy/Legacy.vbproj',
      'src/My Web Api/My Web Api.csproj',
    ]);
  });

  it('skips solution folders and other project types', () => {
    const text =
      project(FOLDER, 'Solution Items', 'Solution Items') +
      project(CS, 'Db', 'db\\Db.sqlproj') +
      project(CS, 'Api', 'Api\\Api.csproj');
    expect(parseSolution('Shop.sln', text)).toEqual(['Api/Api.csproj']);
  });

  it('returns [] for an empty or unrelated file', () => {
    expect(parseSolution('Empty.sln', 'Microsoft Visual Studio Solution File\nGlobal\nEndGlobal\n')).toEqual([]);
    expect(parseSolution('x.sln', 'not a solution')).toEqual([]);
  });

  it('reads .slnx project paths (as dotnet new sln writes them since .NET 10)', () => {
    const text =
      '\uFEFF<Solution>\n  <Folder Name="/src/">\n    <Project Path="src/Shop.Api/Shop.Api.csproj" />\n' +
      '    <Project Path="src\\R&amp;D\\RnD.fsproj" Type="Classic F#" />\n  </Folder>\n' +
      '  <Project Path="db/Db.sqlproj" />\n</Solution>\n';
    expect(parseSolution('Shop.slnx', text)).toEqual(['src/Shop.Api/Shop.Api.csproj', 'src/R&D/RnD.fsproj']);
  });
});

describe('isTestName', () => {
  it.each(['test', 'tests', 'Tests', 'Shop.Tests', 'Shop.Api.Tests', 'Shop.IntegrationTests', 'api-test', 'UnitTests', 'tests.unit'])(
    '%s is a test project',
    (name) => expect(isTestName(name)).toBe(true),
  );
  it.each(['Api', 'Contest', 'Latest', 'Testimonials', 'Shop.Testing', 'src'])('%s is not', (name) =>
    expect(isTestName(name)).toBe(false),
  );
});
