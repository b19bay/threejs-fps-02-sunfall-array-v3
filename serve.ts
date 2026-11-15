// serve.ts — a tiny static server for game/ only. Standard library only.
// Usage: node serve.ts --port 8091   (default port 8080)
// Serves game/index.html for the root path, correct MIME types, no-store
// caching, and refuses any path that escapes game/.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const GAME_DIR = resolve(join(ROOT, 'game'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function portFromArgs(): number {
  const args = process.argv.slice(2);
  const i = args.indexOf('--port');
  if (i >= 0 && args[i + 1]) {
    const p = parseInt(args[i + 1], 10);
    if (Number.isSafeInteger(p) && p > 0 && p < 65536) return p;
  }
  return 8080;
}

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(join(GAME_DIR, '.' + path));
    if (file !== GAME_DIR && !file.startsWith(GAME_DIR + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'content-length': body.length });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
});

const port = portFromArgs();
server.listen(port, '127.0.0.1', () => {
  console.log(`serving game/ at http://127.0.0.1:${port}/`);
});
