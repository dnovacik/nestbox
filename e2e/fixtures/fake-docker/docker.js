// A stand-in for `docker compose` in the end-to-end tests (CI runners can't be relied on for Docker). It keeps
// container states in .fake-docker.json in the working directory (the copied fixture project).
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SERVICES = ['db', 'web'];
const PORTS = { db: [5432, 5432], web: [8080, 3000] };
const file = join(process.cwd(), '.fake-docker.json');
const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
const save = (state) => writeFileSync(file, JSON.stringify(state));

const args = process.argv.slice(2);
if (args[0] !== 'compose' || args[1] !== '-f') {
  console.error('fake docker: only "compose -f <file>" is supported');
  process.exit(1);
}
const [command, ...rest] = args.slice(3);
const named = rest.filter((a) => SERVICES.includes(a));
const targets = named.length > 0 ? named : SERVICES;
const state = load();

switch (command) {
  case 'config':
    process.stdout.write(`${SERVICES.join('\n')}\n`);
    break;
  case 'ps':
    for (const service of SERVICES) {
      const s = state[service];
      if (!s) continue;
      const [published, target] = PORTS[service];
      process.stdout.write(
        `${JSON.stringify({
          Service: service,
          State: s,
          Health: '',
          ExitCode: 0,
          Publishers:
            s === 'running'
              ? [{ URL: '0.0.0.0', TargetPort: target, PublishedPort: published, Protocol: 'tcp' }]
              : [],
        })}\n`,
      );
    }
    break;
  case 'up':
  case 'restart':
    for (const t of targets) {
      state[t] = 'running';
      console.error(` Container fixture-${t}-1  Started`);
    }
    save(state);
    break;
  case 'stop':
    for (const t of targets) {
      if (state[t]) state[t] = 'exited';
      console.error(` Container fixture-${t}-1  Stopped`);
    }
    save(state);
    break;
  case 'down':
    save({});
    console.error(' Network fixture_default  Removed');
    break;
  case 'logs': {
    const service = named[0] ?? 'db';
    console.log(`${service} fake log line 1`);
    console.log(`${service} ready to accept connections`);
    // Follows until NestBox kills it.
    setInterval(() => undefined, 1_000);
    break;
  }
  default:
    console.error(`fake docker: unknown command ${command}`);
    process.exit(1);
}
