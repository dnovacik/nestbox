// An HTTP server on the PORT from .env (the test writes a free one), for the Health end-to-end test.
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const port = Number(/^PORT=(\d+)/m.exec(readFileSync(join(__dirname, '.env'), 'utf8'))?.[1]);
const server = http.createServer((_req, res) => res.end('ok'));
server.listen(port, '127.0.0.1', () => console.log(`listening on port ${port}`));
