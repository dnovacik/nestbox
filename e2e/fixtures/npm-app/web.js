// An HTTP server on a free port for the Ports end-to-end test: records the port, says it is up, then serves.
const http = require('node:http');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const server = http.createServer((_req, res) => res.end('ok'));
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  writeFileSync(join(__dirname, 'web.port'), String(port));
  console.log(`listening on port ${port}`);
});
