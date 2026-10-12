import { z } from 'zod';
import { defineContract, defineEvents, type ToolDefinition } from '../../tool';

const settingsSchema = z.strictObject({});

export const envDefinition: ToolDefinition<z.infer<typeof settingsSchema>> = {
  id: 'env',
  name: 'Env',
  icon: 'key-round',
  // Always: a project without env files still shows "No .env files".
  appliesTo: () => true,
  settingsSchema,
};

export const EnvFileNameSchema = z.string().regex(/^\.env(\..+)?$/).max(200);
export const EnvKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/).max(200);
/** Values are typed by the user; NUL never belongs in a .env file. */
export const EnvValueSchema = z
  .string()
  .max(64 * 1024)
  .refine((v) => !v.includes('\0'), { message: 'nul' });
const Version = z.string().min(1).max(100);
/** A whole env file from the raw editor: the env file size cap (1 MiB), no NUL. */
const EnvTextSchema = z
  .string()
  .max(1024 * 1024)
  .refine((v) => !v.includes('\0'), { message: 'nul' });

export const CELL_STATES = ['set', 'empty', 'absent'] as const;

/** appsettings.json and appsettings.<Environment>.json (.NET configuration files). */
export const APPSETTINGS_FILE = /^appsettings(\.[A-Za-z0-9_-]{1,40})?\.json$/;
/** A .NET configuration path: segments joined by ':' (`Logging:LogLevel:Default`, `AllowedOrigins:0`). */
export const CONFIG_KEY = /^[A-Za-z0-9_.$-]+(:[A-Za-z0-9_.$-]+)*$/;
/** An ASP.NET Core environment name (`Development`), also the middle of its file name. */
export const ENVIRONMENT_NAME = /^[A-Za-z0-9_-]{1,40}$/;
/** A JSON number literal. */
export const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
export const CONFIG_TYPES = ['string', 'number', 'boolean', 'null', 'object', 'array'] as const;
/** The types a value can be edited to (containers are edited as raw text). */
export const EDITABLE_CONFIG_TYPES = ['string', 'number', 'boolean', 'null'] as const;
export type ConfigType = (typeof CONFIG_TYPES)[number];
export type EditableConfigType = (typeof EDITABLE_CONFIG_TYPES)[number];

/** Presence only: the matrix never carries values. */
export const EnvMatrixSchema = z.object({
  /** Columns: the example first, then .env, then the rest alphabetically. */
  files: z.array(
    z.object({
      name: z.string(),
      version: z.string(),
      /** Symlinked files are read-only. */
      readOnly: z.boolean(),
      entries: z.number().int().nonnegative(),
      duplicates: z.array(z.string()),
    }),
  ),
  keys: z.array(
    z.object({
      key: z.string(),
      cells: z.record(z.string(), z.enum(CELL_STATES)),
      /** In the example, not in .env. */
      missing: z.boolean(),
      /** In .env, not in the example. */
      undocumented: z.boolean(),
    }),
  ),
  /** The example file used for the flags, or null. */
  example: z.string().nullable(),
  profiles: z.array(z.object({ name: z.string(), file: z.string(), active: z.boolean() })),
});
export type EnvMatrix = z.infer<typeof EnvMatrixSchema>;

const CellInput = z.strictObject({ file: EnvFileNameSchema, key: EnvKeySchema });

export const AppSettingsFileSchema = z.string().regex(APPSETTINGS_FILE);
export const ConfigKeySchema = z.string().max(200).regex(CONFIG_KEY);
const ConfigTypeInput = z.enum(EDITABLE_CONFIG_TYPES);
const ConfigCell = z.strictObject({ file: AppSettingsFileSchema, key: ConfigKeySchema });

/** appsettings*.json keys × files, presence only (like the env matrix). */
export const ConfigMatrixSchema = z.object({
  /** The package has a .NET ecosystem (the section comes first, the .env one only with files). */
  dotnet: z.boolean(),
  /** Columns: appsettings.json, Development, Staging, Production, then the rest alphabetically. */
  files: z.array(
    z.object({
      name: z.string(),
      /** null when the file couldn't be read (too large). */
      version: z.string().nullable(),
      readOnly: z.boolean(),
      /** Over 1 MiB or 2,000 keys: listed, not read. */
      tooLarge: z.boolean(),
      /** Not JSON with an object at the root: only raw edit. */
      invalid: z.boolean(),
      entries: z.number().int().nonnegative(),
      /** Keys that appear more than once when case is ignored (.NET takes the last). */
      caseDuplicates: z.array(z.string()),
    }),
  ),
  keys: z.array(
    z.object({
      key: z.string(),
      cells: z.record(z.string(), z.enum(CELL_STATES)),
      /** In appsettings.json and in an environment file. */
      overridden: z.boolean(),
      /** Only in environment files (appsettings.json exists). */
      envOnly: z.boolean(),
    }),
  ),
  /** Each launch profile and the environment it runs as; file = appsettings.<environment>.json. */
  profiles: z.array(z.object({ name: z.string(), environment: z.string(), file: z.string(), exists: z.boolean() })),
  /** More than 20 settings files: the rest aren't shown. */
  truncated: z.boolean(),
});
export type ConfigMatrix = z.infer<typeof ConfigMatrixSchema>;

export const envContract = defineContract({
  matrix: { input: z.strictObject({}), output: EnvMatrixSchema },
  /** One value, shown on request. */
  reveal: { input: CellInput, output: z.object({ value: z.string() }) },
  /** Main writes the clipboard: the value never reaches the renderer. */
  copy: { input: CellInput, output: z.object({}) },
  setValue: {
    input: z.strictObject({ file: EnvFileNameSchema, key: EnvKeySchema, value: EnvValueSchema, version: Version }),
    output: z.object({ version: z.string() }),
  },
  /** version null creates the file. */
  addKey: {
    input: z.strictObject({ file: EnvFileNameSchema, key: EnvKeySchema, value: EnvValueSchema, version: Version.nullable() }),
    output: z.object({ version: z.string() }),
  },
  removeKey: {
    input: z.strictObject({ file: EnvFileNameSchema, key: EnvKeySchema, version: Version }),
    output: z.object({ version: z.string() }),
  },
  /** Copies the profile over .env after saving the old .env as .env.backup. envVersion null: .env is absent. */
  switchProfile: {
    input: z.strictObject({ file: EnvFileNameSchema, envVersion: Version.nullable() }),
    output: z.object({}),
  },
  /** The whole file as text, for the raw editor (the user asked to see every value). */
  readRaw: { input: z.strictObject({ file: EnvFileNameSchema }), output: z.object({ text: z.string(), version: z.string() }) },
  /** Replaces the whole file, if it is still at version (CONFLICT otherwise). */
  writeRaw: {
    input: z.strictObject({ file: EnvFileNameSchema, text: EnvTextSchema, version: Version }),
    output: z.object({ version: z.string() }),
  },
  /** Env variable names the package's source reads (`os.getenv("X")`, `process.env.X`): names only. */
  codeKeys: {
    input: z.strictObject({}),
    output: z.object({
      keys: z.array(z.object({ key: z.string(), files: z.number().int().positive() })),
      files: z.number().int().nonnegative(),
      truncated: z.boolean(),
    }),
  },
  /** A new env file with these keys and empty values; CONFLICT when it exists. */
  createFile: {
    input: z.strictObject({ file: EnvFileNameSchema, keys: z.array(EnvKeySchema).max(500) }),
    output: z.object({ version: z.string() }),
  },
  /** appsettings*.json, presence only. */
  configMatrix: { input: z.strictObject({}), output: ConfigMatrixSchema },
  /** One value, shown on request: a string as is, other values as JSON text. */
  configReveal: { input: ConfigCell, output: z.object({ value: z.string(), type: z.enum(CONFIG_TYPES) }) },
  configCopy: { input: ConfigCell, output: z.object({}) },
  configSetValue: {
    input: z.strictObject({ file: AppSettingsFileSchema, key: ConfigKeySchema, value: EnvValueSchema, type: ConfigTypeInput, version: Version }),
    output: z.object({ version: z.string() }),
  },
  /** version null creates the file. CONFLICT when the key exists. */
  configAddKey: {
    input: z.strictObject({
      file: AppSettingsFileSchema,
      key: ConfigKeySchema,
      value: EnvValueSchema,
      type: ConfigTypeInput,
      version: Version.nullable(),
    }),
    output: z.object({ version: z.string() }),
  },
  configRemoveKey: {
    input: z.strictObject({ file: AppSettingsFileSchema, key: ConfigKeySchema, version: Version }),
    output: z.object({ version: z.string() }),
  },
  readConfigRaw: { input: z.strictObject({ file: AppSettingsFileSchema }), output: z.object({ text: z.string(), version: z.string() }) },
  /** The text must be JSON (comments allowed) with an object at the root. */
  writeConfigRaw: {
    input: z.strictObject({ file: AppSettingsFileSchema, text: EnvTextSchema, version: Version }),
    output: z.object({ version: z.string() }),
  },
  /** appsettings.<environment>.json as {}; CONFLICT when it exists. */
  createConfigFile: {
    input: z.strictObject({ environment: z.string().regex(ENVIRONMENT_NAME) }),
    output: z.object({ version: z.string(), file: z.string() }),
  },
  /** PORT from .env (for the Ports card), never other values. */
  facts: { input: z.strictObject({}), output: z.object({ port: z.number().int().nullable() }) },
});

export const envEvents = defineEvents({
  /** An env file in the package folder changed (on disk or through NestBox). */
  changed: z.undefined(),
});
