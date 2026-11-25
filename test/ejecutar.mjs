// =============================================================================
// ejecutar.mjs — lanza el banco de pruebas en Chromium sin pantalla.
//   node test/ejecutar.mjs            (desde la raíz del repositorio)
// Requiere Playwright. Guarda las imágenes con la superposición en test/salida/.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { servir } from './servidor.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { servidor, puerto } = await servir(raiz);

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
pagina.on('console', (m) => console.log('[navegador]', m.text()));
pagina.on('pageerror', (e) => console.log('[error]', e.message));
await pagina.goto(`http://localhost:${puerto}/test/banco.html`);
const resultado = await pagina.waitForFunction(() => window.__resultado, null, { timeout: 120000 }).then((h) => h.jsonValue());
await navegador.close();
servidor.close();

const dirSalida = path.join(raiz, 'test', 'salida');
fs.mkdirSync(dirSalida, { recursive: true });
const f = (x) => (x == null ? '  —  ' : x.toFixed(2).padStart(5));
let fallos = 0;
console.log('\nescena          variante    calidad  ms   segs  focal  err x / vert / z (°)    horiz(°)  familias');
for (const r of resultado) {
  const e = r.errorEjes;
  let ok;
  if (!e) ok = !r.fiable;                                   // sin estructura: no debe inventar
  else ok = Object.values(e).filter((x) => x != null && x < 2).length >= 2 && r.errorHorizonte != null && r.errorHorizonte < 2 &&
    (r.pendientes || []).every((p) => p && p.error < 2 && Math.abs(p.medida - p.real) < 2);
  if (!ok) fallos++;
  console.log(
    `${ok ? '✔' : '✘'} ${r.escena.padEnd(14)} ${r.variante.padEnd(11)} ${r.calidad.padEnd(5)} ${String(r.ms).padStart(4)} ${String(r.segmentos).padStart(5)}  ${String(r.focalMM).padStart(5)}${r.fuenteFocal === 'escena' ? 'e' : ' '} ` +
    (e ? `${f(e.x)} / ${f(e.vertical)} / ${f(e.z)}` : '        (sin verdad)      ') +
    `   ${f(r.errorHorizonte)}    ${r.familias.join(' ') || r.mensaje}` +
    ((r.pendientes || []).length ? `   PENDIENTE: ${r.pendientes.map((p) => (p ? `error ${p.error.toFixed(2)}°, mide ${p.medida.toFixed(1)}° (real ${p.real.toFixed(1)}°)` : 'NO DETECTADA')).join('; ')}` : '')
  );
  if (r.imagen) fs.writeFileSync(path.join(dirSalida, `${r.escena}.jpg`), Buffer.from(r.imagen.split(',')[1], 'base64'));
}
fs.writeFileSync(path.join(dirSalida, 'informe.json'), JSON.stringify(resultado.map(({ imagen, ...x }) => x), null, 2));
console.log(`\n${resultado.length - fallos}/${resultado.length} pruebas superadas (criterio: ≥ 2 ejes, horizonte y pendientes con error < 2°; sin estructura → "no fiable").`);
process.exit(fallos ? 1 : 0);
