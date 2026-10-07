# NestBox v2: appsettings.json in the Env tool (design, 1.24.0)

.NET projects keep configuration in `appsettings.json` and `appsettings.<Environment>.json`, not in `.env` files, so the Env tab of a .NET package has nothing useful today. This adds a **Configuration** section to the Env tool: the same matrix, masking, reveal and safe edits as `.env`, for `appsettings*.json`.

## Owner's answers (2026-10-07)

- **Inside the Env tool**, not a new tool.
- **Every value is masked** until revealed, like `.env` (not only secret-looking keys).
- **Editing:** one value, add/remove a key, and raw edit of the whole file (JSON-checked before saving). Not read-only.
- **Scope:** `appsettings*.json` only. launchSettings' `environmentVariables` stay unread, except each profile's environment *name* (below). User secrets and `Section__Key` environment overrides are out of scope.

## Files and keys

- **Files:** `appsettings.json` and `appsettings.<Name>.json` in the package folder (`^appsettings(\.[A-Za-z0-9_-]{1,40})?\.json$`). Columns: `appsettings.json` first, then `Development`, `Staging`, `Production`, then the rest alphabetically.
- **Keys** are .NET's configuration paths: objects are joined with `:` (`Logging:LogLevel:Default`, `ConnectionStrings:Default`), array items by index (`AllowedOrigins:0`). Leaves are strings, numbers, booleans and `null`. An empty object or array is a key of its own (state `empty`).
- **Cell states:** `set`, `empty` (`""`, `null`, `{}` or `[]`), `absent`. .NET matches keys case-insensitively, so two keys that differ only in case are one row, and the file is flagged (like `.env` duplicates).
- **Flags per row:** `overridden` (set in `appsettings.json` and in an environment file) and `envOnly` (only in environment files). There is no "missing"/"undocumented" pair: `appsettings.json` is the base, not an example.
- **Caps:** 1 MiB per file, at most 2,000 keys per file and 20 files. Over a cap the file is listed with `tooLarge` and not read.

## Which environment runs

`detect.ts` adds an `environment` to each launch profile: the value of `ASPNETCORE_ENVIRONMENT` (else `DOTNET_ENVIRONMENT`), kept only when it matches `^[A-Za-z0-9_-]{1,40}$`. That one value is an environment name, not a secret. Every other variable is still never read into results. A profile without one runs as `Production`, .NET's default.

The section shows a line per profile, e.g. `http → Development`. When the matching `appsettings.<Env>.json` doesn't exist, that line offers to create it as `{}`.

## Reading and writing

- **Parsing:** `jsonc-parser` (Microsoft's, used by VS Code; a main-process `dependency`). appsettings files may have comments and trailing commas, and .NET accepts both. A file that doesn't parse is listed with `invalid` and only raw edit is offered.
- **Edits keep the file:** `modify()` and `applyEdits()` change only the edited value, so comments, order, indentation, line endings and a BOM stay as they were. New keys go at the end of their parent object; missing parents are created. Removing the last key of an object leaves `{}`.
- **Value types:** the edit dialog has a type select (text, number, true/false, null) that defaults to the current type. A new key defaults to text. Numbers must be finite JSON numbers.
- **Versions and conflicts:** writes go through `fs/versioned-file`, the same as `.env` (`ino:mtimeNs:size`, atomic, no symlink writes, a stale version is CONFLICT). A symlinked file is read-only.
- **Raw edit:** `readConfigRaw`/`writeConfigRaw` (the whole text, version-checked). The text must parse as JSONC with an object at the root, or the save is refused (VALIDATION, message without content).

## Contract (Env tool)

New methods, next to the `.env` ones (`AppSettingsFileSchema` for the file name, a configuration path schema for the key: segments of `[A-Za-z0-9_.$-]`, at most 200 characters):

| Method | Input → output |
| --- | --- |
| `configMatrix` | `{}` → files (name, version, readOnly, tooLarge, invalid, entries, caseDuplicates), keys (key, cells, overridden, envOnly), profiles (name, environment, file, exists) |
| `configReveal` | `{ file, key }` → `{ value: string, type }`: one value, as JSON text for non-strings |
| `configCopy` | `{ file, key }` → clipboard written in main |
| `configSetValue` | `{ file, key, value, type, version }` |
| `configAddKey` | `{ file, key, value, type, version }`: CONFLICT if it exists |
| `configRemoveKey` | `{ file, key, version }` |
| `readConfigRaw` / `writeConfigRaw` | like `readRaw`/`writeRaw` |
| `createConfigFile` | `{ environment }` → creates `appsettings.<environment>.json` as `{}` |

Like `.env`, the matrix carries presence only, never values. Values reach the renderer only through `configReveal` and come back only in an edit the user typed. Logs carry file names, method names and codes, never keys or values.

## UI

- **Env panel:** a **Configuration** section with the appsettings matrix (same `ValueCell`, `EditValueDialog` with the type select, `AddVariableDialog`, `RawEditDialog` in JSON mode), the profile → environment lines, and the flags as row badges (`overridden`, `env only`).
- **Ordering:** in a package with a .NET ecosystem, Configuration comes first and the `.env` section shows only when `.env` files exist, so there's no "No .env files" message. Other packages show Configuration only when appsettings files exist.
- **Overview card:** adds the appsettings file count, plus a warning for an `invalid` file.
- **Refresh:** the Env tool's folder watch (started on the first matrix call) includes `appsettings*.json`.

## Related change

In a package whose first ecosystem is `dotnet`, custom commands default to **no env file** instead of `.env` (`defaultEnvFile` in the Scripts tool). .NET doesn't read `.env` itself, so loading it by default surprises. A command that already has an env file chosen keeps it.

## Tests

- **Unit:**
  - flattening (nesting, arrays, empty containers, case duplicates);
  - edits that keep comments, trailing commas, CRLF and a BOM byte-identical outside the edited value;
  - type handling;
  - caps;
  - version CONFLICT;
  - symlink read-only;
  - raw edit validation;
  - profile environments (including that no other variable is read).
  
  Fixtures come from `dotnet new webapi` (SDK 10) plus a hand-written file with comments.
- **e2e** (`dotnet-app` fixture + `appsettings.json` and `appsettings.Development.json`): open Env on Shop.Api and see the matrix and `http → Development`; reveal a value; edit one and confirm the file's comments survive; add a key; a raw edit that doesn't parse is refused; create `appsettings.Production.json` from the profile line.

## Out of scope

- User secrets (`secrets.json`, `dotnet user-secrets`); at most a note when the project file has a `UserSecretsId`.
- `Section__Key` environment variable overrides.
- launchSettings' `environmentVariables` (other than the environment name).
- `ConnectionStrings:*` in the Database tool (a follow-up).
- Merged "effective configuration" for an environment (would need .NET's provider order: user secrets, env vars, command line).
