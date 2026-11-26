// node test/reales.mjs  → analiza test/fotos/*.jpg y guarda test/salida/real-*.jpg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { servir } from './servidor.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fotos = fs.readdirSync(path.join(raiz, 'test/fotos')).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
const { servidor, puerto } = await servir(raiz);
const nav = await chromium.launch();
const p = await nav.newPage();
p.on('pageerror', (e) => console.log('[error]', e.message));
const alejar = process.argv[2] || '1';
await p.goto(`http://localhost:${puerto}/test/reales.html?fotos=${fotos.join(',')}&alejar=${alejar}&capas=${process.argv[3] || ''}${process.env.DEBUG ? '&debug=1' : ''}`);
const res = await p.waitForFunction(() => window.__resultado, null, { timeout: 120000 }).then((h) => h.jsonValue());
await nav.close(); servidor.close();
fs.mkdirSync(path.join(raiz, 'test/salida'), { recursive: true });
if (process.env.DEBUG) fs.writeFileSync(path.join(raiz, 'test/salida/depuracion.json'), JSON.stringify(res.map((r) => ({ foto: r.foto, ...r.depuracion }))));
for (const r of res) {
  fs.writeFileSync(path.join(raiz, 'test/salida', `real-${r.foto.replace(/\.\w+$/, '')}${alejar !== '1' ? '-lejos' : ''}${process.argv[3] ? '-' + process.argv[3] : ''}.jpg`), Buffer.from(r.imagen.split(',')[1], 'base64'));
  console.log(`\n${r.foto}  focal ${r.focalMM} mm (${r.fuenteFocal})  horizonte: ${r.horizonte}  ${JSON.stringify(r.comprobacion)}`);
  for (const f of r.familias) console.log('   ', f);
}
