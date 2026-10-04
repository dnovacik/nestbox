// An API on the PORT from .env (the test writes a free one) that echoes each request as JSON, for the
// inspector end-to-end test.
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const port = Number(/^PORT=(\d+)/m.exec(readFileSync(join(__dirname, '.env'), 'utf8'))?.[1]);
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ method: req.method, url: req.url, body }));
  });
});
server.listen(port, '127.0.0.1', () => console.log(`listening on port ${port}`));
