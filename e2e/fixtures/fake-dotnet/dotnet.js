// A stand-in for the dotnet CLI in the end-to-end tests: `--list-sdks`, `run` (prints ASP.NET Core's
// listening line and stays up until killed) and `list <project> package --outdated|--vulnerable --format
// json` with real SDK 10.0.401 output, cut to the asked project. Every call is appended to .fake-dotnet.log
// in the working folder, so a test can check the arguments.
const { appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
appendFileSync(join(process.cwd(), '.fake-dotnet.log'), `${args.join(' ')}\n`);

if (args[0] === '--list-sdks') {
  process.stdout.write(
    '8.0.414 [C:\\Program Files\\dotnet\\sdk]\n10.0.401 [C:\\Program Files\\dotnet\\sdk]\n',
  );
} else if (args[0] === 'run' || args[0] === 'watch') {
  const profile = args.includes('--launch-profile')
    ? args[args.indexOf('--launch-profile') + 1]
    : 'default';
  console.log(`Using launch settings profile ${profile}`);
  console.log('info: Microsoft.Hosting.Lifetime[14]');
  console.log('      Now listening on: http://localhost:5283');
  setInterval(() => undefined, 1_000);
} else if (args[0] === 'list' && args[2] === 'package') {
  const file = args.includes('--outdated') ? 'list-outdated.json' : 'list-vulnerable.json';
  const report = JSON.parse(readFileSync(join(__dirname, file), 'utf8'));
  report.projects = report.projects.filter((p) => p.path.endsWith(`/${args[1]}`));
  process.stdout.write(JSON.stringify(report, null, 2));
} else {
  console.log(`fake dotnet: ${args.join(' ')}`);
}
