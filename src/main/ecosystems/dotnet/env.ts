/** Every dotnet command NestBox runs: no telemetry, no banner or first-run text in its output. */
export const DOTNET_ENV: Record<string, string> = {
  DOTNET_NOLOGO: '1',
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
};
