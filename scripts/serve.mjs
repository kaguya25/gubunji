import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};
createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(5173, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:5173'));
