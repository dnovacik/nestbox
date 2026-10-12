# NestBox v2: ConnectionStrings in the Database tool (design, 1.25.0)

The Database tool knows Prisma and `.env` URLs only, but a .NET package keeps its database connections in `appsettings*.json` under `ConnectionStrings:<Name>`. This adds a **Connections** card to the Database tab of a .NET package: each connection's provider, host, port and database for an environment you pick, and whether the server answers. Issue #41.

## Owner's answers (2026-10-12)

- **Connections only.** No EF Core commands in this release (they're #43).
- **Pick an environment.** A select that defaults to the first launch profile's environment (`Production` when there are none). Each connection shows the value .NET would use there.
- **Approach:** a `.NET` part next to the existing Prisma status, not a rewrite of the tool around a list of sources.

## Which value

- **Files:** `appsettings.json` and `appsettings.<Environment>.json` in the package folder, read through the Env tool's settings file access and `parseConfig` (1.24.0: JSONC, 1 MiB, versioned reads). A file that is invalid or too large is skipped.
- **Overlay:** for the picked environment, `ConnectionStrings:<Name>` from `appsettings.<Environment>.json` wins over `appsettings.json`. Names match case-insensitively; the last spelling in a file wins, as in .NET. Each row keeps the name (in the first file's spelling) and the file its value came from.
- **Environments offered:**
  - the launch profiles' environments (in profile order);
  - then the `appsettings.<Name>.json` files that exist;
  - then `Production`.
  
  No duplicates, ignoring case. The input is validated with `ENVIRONMENT_NAME`; an environment that isn't offered is still accepted (its file may not exist yet).
- **Caps:** at most 20 connections; more are cut and flagged `truncated`. A value that isn't a string (or is empty) is listed with an `unknown` target and `not-checked`.
- **Out of reach:** environment variables (`ConnectionStrings__X`), user secrets and command-line overrides. The card says so in one line.

## Describing a connection string (`ado.ts`)

- **URLs:** a value with a scheme (`postgres://`, `postgresql://`, `mysql://`, `mongodb://`, `mongodb+srv://`) or `file:` goes through the existing `describeUrl` (SQLite files resolved from the package folder).
- **ADO.NET strings:** `Key=Value` pairs separated by `;`.
  - Values may be quoted with `"` or `'`; a doubled quote inside a quoted value is one quote.
  - Keys are case-insensitive, with spaces inside keys ignored (`Initial Catalog` = `InitialCatalog`).
  - Only these keys are read: `Server`, `Host`, `Data Source`, `DataSource`, `Address`, `Addr`, `Network Address`, `Port`, `Database`, `Initial Catalog`, `Filename`. Every other key (user, password, tokens, options) is dropped in the parser and never stored, logged or returned.
- **Provider:**
  1. The project's NuGet references, when exactly one database provider is referenced:
     - `Npgsql*` → `postgresql`;
     - `Microsoft.Data.SqlClient`, `System.Data.SqlClient`, `Microsoft.EntityFrameworkCore.SqlServer` → `sqlserver`;
     - `Microsoft.Data.Sqlite*`, `Microsoft.EntityFrameworkCore.Sqlite*`, `System.Data.SQLite*` → `sqlite`;
     - `MySqlConnector`, `MySql.Data`, `MySql.EntityFrameworkCore`, `Pomelo.EntityFrameworkCore.MySql` → `mysql`;
     - `MongoDB.Driver`, `MongoDB.EntityFrameworkCore` → `mongodb`.
  2. Otherwise the string's own keys:
     - `Host` → `postgresql`;
     - `Initial Catalog`, `Trusted_Connection`, `Integrated Security`, `Encrypt`, `TrustServerCertificate`, `MultipleActiveResultSets` or a `tcp:`/`np:`/`(localdb)` or `host\Instance` server → `sqlserver`;
     - a `Data Source`/`Filename` ending in `.db`, `.sqlite`, `.sqlite3` or `:memory:` → `sqlite`.
  3. Else `unknown` (host, port and database are still shown when present).
- **Detection:** `parseProjectFile` keeps `dbProviders` (the provider names above, sorted, no duplicates) in the .NET info. Package names themselves are already read for the test flag; nothing else is kept.
- **Default ports:** postgresql 5432, sqlserver 1433, mysql 3306, mongodb 27017.
- **SQL Server addresses:**
  - `tcp:host,port` and `host,port` give host and port;
  - `host\Instance` without a port is `not-checked` ("A named instance is found through SQL Browser"), and so is `(localdb)\…` ("LocalDB runs on demand") and an `np:` pipe;
  - `.`, `(local)` and `localhost` are `localhost`.
- **PostgreSQL:** a `Host` list (`a,b`) uses the first host; `Host` may carry `:port`.
- **SQLite:**
  - `Data Source`/`Filename` is resolved from the package folder (the content root `dotnet run` uses);
  - `:memory:` and `|DataDirectory|` are `not-checked`;
  - the existing check reports `missing-file`.

## Contract

- **Input:** `status` takes `{ environment?: string }` (still a strict object; `{}` keeps today's behaviour).
- **Output:** `status` gains a `dotnet` part, null for packages without a .NET project file:

```ts
dotnet: {
  environment: string,            // the one used
  environments: string[],         // offered in the select
  connections: {
    name: string,
    file: string,                 // appsettings.json or appsettings.<Env>.json
    target: { provider, host, port, database, file },   // DbTarget, never the raw value
    reach: { result, reason },    // the existing REACH_RESULTS
  }[],
  truncated: boolean,
} | null
```

- **Checks:** reachability runs `checkReachable` for every connection in parallel (3 s each).
- **Logs:** counts and codes only (connections, reachable), never names, hosts or values.
- **appliesTo:** the Database tool also applies when the package has a `dotnet` ecosystem entry with a project file. Without connection strings the card says "No ConnectionStrings in appsettings for <Env>."

## UI

- **Connections card** (aria-label "Connections"), shown in a .NET package above the Prisma parts:
  - **Header:** an environment select (aria-label "Environment"), plus a refresh that refetches with the same environment.
  - **Rows:** the connection name, `targetLabel(target)` (`postgresql · localhost:5432/shop`, `SQLite · app.db`), the source file, and the reach label with its tone and reason.
  - **Note:** "appsettings only: .NET also reads environment variables and user secrets."
- **Selection:** the select's value lives in the renderer (per project, not stored); the status query key includes it.
- **Prisma:** the Prisma card, actions and log show only when there's a Prisma schema, as today. A .NET package without Prisma gets no "No Prisma schema" line.
- **Overview card:** in a .NET package it shows `N connections · M answer`, with the err tone when any connection is refused, times out or its host isn't found.

## Tests

- **Unit:**
  - `ado.ts`:
    - quoting and `;;`;
    - every provider and each key hint;
    - SQL Server address forms;
    - PostgreSQL host lists;
    - SQLite paths and `:memory:`;
    - URLs handed to `describeUrl`;
    - a password, user or token never appearing in any output.
  - `parseProjectFile`'s `dbProviders`.
  - The environment overlay (case-insensitive, the last one wins, invalid files skipped).
  - `status` with an environment, and its logs without names or values.
  - The renderer card, the environment select and the overview card line.
- **e2e:** the `dotnet-app` fixture gets `ConnectionStrings:Shop` (PostgreSQL, a closed port) in `appsettings.json`, and a Development override pointing at a TCP server the test starts on `127.0.0.1`.
  - Open Database on Shop.Api: `Development` is selected and `Shop` is Reachable from `appsettings.Development.json`.
  - Switch to `Production`: `Shop` is Refused from `appsettings.json`.
  - The password never shows anywhere on the page.

## Out of scope

- EF Core commands and a login test (#43).
- Environment variables, user secrets and command-line overrides.
- Editing connection strings here (the Env tab's Configuration section does that).
- Oracle, DB2, Firebird and other providers (`unknown` with host and port when the keys give them).
