// A stand-in for `cloudflared tunnel --url …` in the end-to-end tests: prints a quick-tunnel banner and
// stays up until NestBox stops it. It doesn't proxy anything.
const args = process.argv.slice(2);
if (args[0] !== 'tunnel' || !args.includes('--url')) {
  console.error('fake cloudflared: only "tunnel --url" is supported');
  process.exit(1);
}
console.error('INF Thank you for trying Cloudflare Tunnel.');
console.error('INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |');
console.error('INF |  https://fake-quick-tunnel-1234.trycloudflare.com                                          |');
setInterval(() => undefined, 1_000);
