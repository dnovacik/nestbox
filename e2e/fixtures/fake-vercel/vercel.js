// A stand-in for the Vercel CLI in the end-to-end tests: `list --format json` answers with the shape
// Vercel CLI 62 prints, and `deploy` prints progress and a deployment URL, like the real one, without
// any network. Every call is appended to .fake-vercel.log in the project, so a test can check the flags.
const { appendFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
appendFileSync(join(process.cwd(), '.fake-vercel.log'), `${args.join(' ')}\n`);
const [command] = args;
if (command === 'list' && args.includes('json')) {
  process.stdout.write(readFileSync(join(__dirname, 'list.json'), 'utf8'));
} else if (command === 'deploy') {
  const prod = args.includes('--prod');
  process.stderr.write('Vercel CLI 62.2.0\nUploading [====================] (1.2KB/1.2KB)\n');
  process.stdout.write('Inspect: https://vercel.com/acme/shop/9fake [1s]\n');
  setTimeout(() => {
    process.stdout.write(
      prod
        ? 'Production: https://shop-acme.vercel.app [3s]\n'
        : 'Preview: https://shop-git-e2e-acme.vercel.app [3s]\n',
    );
  }, 300);
} else {
  console.error(`fake vercel: unsupported ${command}`);
  process.exitCode = 2;
}
