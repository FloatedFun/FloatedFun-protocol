import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, normalize } from 'node:path';
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
export function serve(dir, port = 0) {
  const root = resolve(dir);
  const srv = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    const f = normalize(join(root, p)); if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
    try { const b = await readFile(f); res.writeHead(200, { 'content-type': T[extname(f)] || 'application/octet-stream' }).end(b); } catch { res.writeHead(404).end('nf'); }
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok({ srv, port: srv.address().port, close: () => srv.close() })));
}
