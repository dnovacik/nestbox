// A stand-in for npm in the end-to-end tests: answers `outdated --json` and `audit --json` with real npm 10
// output (exit 1, as npm does when it finds something), so no registry is needed.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const [command, ...rest] = process.argv.slice(2);
// npm exits 1 when it finds something. exitCode, not exit(): on Windows stdout to a pipe is asynchronous, and
// process.exit() can cut the JSON short.
const answer = (file) => {
  process.stdout.write(readFileSync(join(__dirname, file), 'utf8'));
  process.exitCode = 1;
};
if (command === 'outdated' && rest.includes('--json')) answer('outdated.json');
else if (command === 'audit' && rest.includes('--json')) answer('audit.json');
else {
  console.error(`fake npm: unsupported ${command}`);
  process.exitCode = 2;
}
