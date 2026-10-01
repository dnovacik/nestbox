// Long-running script for the end-to-end tests: records its PID, says it is up, then idles.
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

writeFileSync(join(__dirname, 'server.pid'), String(process.pid));
console.log('listening');
setInterval(() => {}, 1000);
