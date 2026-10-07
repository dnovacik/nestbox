/**
 * Parse a .NET solution file (.sln) to extract project references.
 *
 * A .sln file contains lines like:
 * Project("{GUID}") = "ProjectName", "path\to\Project.csproj", "{PROJECT-GUID}"
 *
 * We extract the path to each .csproj file.
 */

export interface SlnProject {
  name: string;
  /** Relative path from .sln to .csproj, with backslashes (as in .sln) */
  path: string;
}

/**
 * Parse a .sln file and return the list of project paths it references.
 * Returns null if the file is not a valid .sln or has no projects.
 */
export function parseSln(content: string): SlnProject[] | null {
  const lines = content.split(/\r?\n/);
  const projects: SlnProject[] = [];

  // Match: Project("{GUID}") = "Name", "path\to\Project.csproj", "{GUID}"
  // The path can have forward or backslashes, and may have spaces
  const projectRegex = /^Project\s*\("\{[A-F0-9-]+\}"\)\s*=\s*"([^"]+)"\s*,\s*"([^"]+\.(?:csproj|fsproj|vbproj))"\s*,/i;

  for (const line of lines) {
    const match = projectRegex.exec(line);
    if (match) {
      const name = match[1];
      const path = match[2];
      if (name && path) {
        projects.push({ name, path });
      }
    }
  }

  return projects.length > 0 ? projects : null;
}
