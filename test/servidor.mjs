// Servidor estático mínimo para las pruebas (http://localhost cuenta como "seguro" para la cámara).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

export async function servir(raiz, puerto = 0) {
  const servidor = http.createServer((req, res) => {
    let ruta = path.join(raiz, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (ruta.endsWith(path.sep)) ruta = path.join(ruta, 'index.html');
    if (!ruta.startsWith(raiz) || !fs.existsSync(ruta) || fs.statSync(ruta).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(ruta).pipe(res);
  });
  await new Promise((ok) => servidor.listen(puerto, ok));
  return { servidor, puerto: servidor.address().port };
}
