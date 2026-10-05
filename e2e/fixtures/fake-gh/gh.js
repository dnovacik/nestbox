// A stand-in for the GitHub CLI in the end-to-end tests: `run list`, `run view --json jobs`,
// `run view --job <id> --log-failed` and `run rerun --failed` answer like gh 2.x, without any network.
// Every call is appended to .fake-gh.log in the project, so a test can check the flags.
const { appendFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
appendFileSync(join(process.cwd(), '.fake-gh.log'), `${args.join(' ')}\n`);

const runs = [
  {
    databaseId: 9001,
    status: 'completed',
    conclusion: 'failure',
    workflowName: 'CI',
    displayTitle: 'Fix the cart totals',
    headBranch: 'main',
    headSha: '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d',
    event: 'push',
    createdAt: '2026-10-05T06:00:00Z',
    updatedAt: '2026-10-05T06:04:00Z',
    url: 'https://github.com/acme/shop/actions/runs/9001',
  },
  {
    databaseId: 9000,
    status: 'completed',
    conclusion: 'success',
    workflowName: 'CI',
    displayTitle: 'Add the cart',
    headBranch: 'main',
    headSha: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
    event: 'push',
    createdAt: '2026-10-04T18:00:00Z',
    updatedAt: '2026-10-04T18:05:00Z',
    url: 'https://github.com/acme/shop/actions/runs/9000',
  },
];

const jobs = {
  jobs: [
    {
      databaseId: 71,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      startedAt: '2026-10-05T06:00:10Z',
      completedAt: '2026-10-05T06:01:10Z',
      url: 'https://github.com/acme/shop/actions/runs/9001/job/71',
      steps: [{ name: 'Run pnpm build', number: 3, status: 'completed', conclusion: 'success' }],
    },
    {
      databaseId: 72,
      name: 'test',
      status: 'completed',
      conclusion: 'failure',
      startedAt: '2026-10-05T06:01:12Z',
      completedAt: '2026-10-05T06:04:00Z',
      url: 'https://github.com/acme/shop/actions/runs/9001/job/72',
      steps: [
        { name: 'Set up job', number: 1, status: 'completed', conclusion: 'success' },
        { name: 'Run pnpm test', number: 4, status: 'completed', conclusion: 'failure' },
      ],
    },
  ],
};

const [group, command] = args;
if (group === 'run' && command === 'list') {
  process.stdout.write(JSON.stringify(runs));
} else if (group === 'run' && command === 'view' && args.includes('--log-failed')) {
  process.stdout.write(
    [
      'test\tRun pnpm test\t2026-10-05T06:03:58.0000000Z  FAIL  src/cart.test.ts > adds tax',
      'test\tRun pnpm test\t2026-10-05T06:03:59.0000000Z AssertionError: expected 108 to be 110',
      'test\tRun pnpm test\t2026-10-05T06:04:00.0000000Z ##[error]Process completed with exit code 1.',
    ].join('\n') + '\n',
  );
} else if (group === 'run' && command === 'view' && args.includes('jobs')) {
  process.stdout.write(JSON.stringify(jobs));
} else if (group === 'run' && command === 'rerun') {
  process.stderr.write('✓ Requested rerun (failed jobs) of run 9001\n');
} else {
  console.error(`fake gh: unsupported ${args.join(' ')}`);
  process.exitCode = 2;
}
