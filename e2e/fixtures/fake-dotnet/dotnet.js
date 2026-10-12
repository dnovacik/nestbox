// A stand-in for the dotnet CLI in the end-to-end tests: `--list-sdks`, `run` (prints ASP.NET Core's
// listening line and stays up until killed) and `list <project> package --outdated|--vulnerable --format
// json` with real SDK 10.0.401 output, cut to the asked project, `tool restore`, and `ef migrations
// list|add|remove|script` and `ef database update [target]` with EF Core's --prefix-output lines, keeping the
// migrations in .fake-ef.json in the working folder (Init applied, AddProducts pending at first). Every call
// is appended to .fake-dotnet.log in the working folder, so a test can check the arguments.
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
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
} else if (args[0] === 'tool' && args[1] === 'restore') {
  console.log("Tool 'dotnet-ef' (version '10.0.0') was restored.");
} else if (args[0] === 'ef') {
  ef(args.slice(1, args.includes('--project') ? args.indexOf('--project') : args.length));
} else {
  console.log(`fake dotnet: ${args.join(' ')}`);
}

function ef(words) {
  const file = join(process.cwd(), '.fake-ef.json');
  const migrations = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : [
        { id: '20261001000000_Init', name: 'Init', applied: true },
        { id: '20261005000000_AddProducts', name: 'AddProducts', applied: false },
      ];
  const save = () => writeFileSync(file, JSON.stringify(migrations));
  console.log('info:    Build started...');
  console.log('info:    Build succeeded.');
  const [group, action, value] = words;
  if (group === 'migrations' && action === 'list') {
    for (const line of JSON.stringify(migrations, null, 2).split('\n'))
      console.log(`data:    ${line}`);
  } else if (group === 'migrations' && action === 'add') {
    migrations.push({ id: `20261012000000_${value}`, name: value, applied: false });
    save();
    console.log('info:    Done.');
  } else if (group === 'database' && action === 'update') {
    const end =
      value === undefined
        ? migrations.length
        : value === '0'
          ? 0
          : migrations.findIndex((m) => m.id === value) + 1;
    migrations.forEach((m, i) => (m.applied = i < end));
    save();
    console.log('info:    Done.');
  } else if (group === 'migrations' && action === 'remove') {
    const last = migrations.at(-1);
    if (last?.applied) {
      console.log(`error:   The migration '${last.id}' has already been applied to the database.`);
      process.exitCode = 1;
      return;
    }
    migrations.pop();
    save();
    console.log('info:    Done.');
  } else if (group === 'migrations' && action === 'script') {
    console.log('data:    CREATE TABLE "Products" ("Id" integer NOT NULL);');
  }
}
