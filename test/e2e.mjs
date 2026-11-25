// =============================================================================
// e2e.mjs — prueba de la app completa en Chromium sin pantalla, con una cámara
// FALSA que emite una escena sintética. Recorre: inicio → cámara en vivo →
// congelar → modo B (tocar línea) → cargar foto → exportar.
//   node test/e2e.mjs        (desde la raíz del repositorio)
// Las capturas quedan en test/salida/e2e-*.png. No sustituye a probar en un móvil.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { servir } from './servidor.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const salida = path.join(raiz, 'test', 'salida');
fs.mkdirSync(salida, { recursive: true });

const { servidor, puerto } = await servir(raiz);
const base = `http://localhost:${puerto}`;

// 1. Renderizar escenas sintéticas como JPEG (vídeo falso y foto de prueba)
let navegador = await chromium.launch();
let pagina = await navegador.newPage();
await pagina.goto(`${base}/test/banco.html?solo-generar`);
// argumentos opcionales: escena del vídeo falso y orientación (p. ej. `node test/e2e.mjs salon vertical`)
const escenaVideo = process.argv[2] || 'calle';
const vertical = process.argv[3] === 'vertical';
const jpgs = await pagina.evaluate(async ({ escenaVideo, vertical }) => {
  const { ESCENAS, generar } = await import('./escenas.js');
  const out = {};
  for (const [clave, n] of [['calle', escenaVideo], ['fachada', 'fachada']]) {
    const { lienzo } = vertical && clave === 'calle' ? generar(ESCENAS.find((e) => e.nombre === n), 960, 1280) : generar(ESCENAS.find((e) => e.nombre === n));
    out[clave] = lienzo.toDataURL('image/jpeg', 0.9).split(',')[1];
  }
  return out;
}, { escenaVideo, vertical });
await navegador.close();
const rutaCalle = path.join(salida, 'calle.raw.jpg');
const rutaFachada = path.join(salida, 'fachada.raw.jpg');
fs.writeFileSync(rutaCalle, Buffer.from(jpgs.calle, 'base64'));
fs.writeFileSync(rutaFachada, Buffer.from(jpgs.fachada, 'base64'));
const rutaVideo = path.join(salida, 'camara-falsa.mjpeg');
fs.writeFileSync(rutaVideo, Buffer.concat(Array(10).fill(Buffer.from(jpgs.calle, 'base64'))));

// 2. App con cámara falsa, en un viewport de móvil
navegador = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${rutaVideo}`],
});
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, acceptDownloads: true });
await contexto.grantPermissions(['camera'], { origin: base });
pagina = await contexto.newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(e.message));
pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

const paso = async (nombre) => {
  await pagina.screenshot({ path: path.join(salida, `e2e-${nombre}.png`) });
  const texto = await pagina.evaluate(() => ({
    mensaje: document.getElementById('mensaje').hidden ? '' : document.getElementById('mensaje').textContent,
    sensor: document.getElementById('sensor').textContent,
    info: document.getElementById('info').textContent,
    resumen: document.getElementById('resumen').hidden ? '' : document.getElementById('resumen').innerText.replace(/\n/g, ' | '),
    boton: document.getElementById('btn-congelar').textContent,
  }));
  console.log(`· ${nombre}:`, JSON.stringify(texto));
};

await pagina.goto(`${base}/index.html`);
await paso('1-inicio');
await pagina.click('#btn-empezar');
await pagina.waitForTimeout(3500);
await paso('2-vivo');

await pagina.click('#btn-congelar');
await pagina.waitForTimeout(2500);
await paso('3-congelado');

// encuadre "Ver fugas": la foto y sus puntos de fuga en pantalla; se exporta esa vista
await pagina.click('#btn-vista');
await pagina.waitForTimeout(400);
await paso('3b-ver-fugas');
{
  const ds = [];
  const oyente = (d) => ds.push(d);
  pagina.on('download', oyente);
  await pagina.click('#btn-exportar');
  await pagina.waitForTimeout(2000);
  pagina.off('download', oyente);
  for (const d of ds) if (d.suggestedFilename().endsWith('.png')) await d.saveAs(path.join(salida, 'e2e-export-vista-fugas.png'));
}
// la imagen exportada debe tener la proporción de la pantalla (lo que se ve es lo que se guarda)
{
  const { createRequire: cr } = await import('node:module');
  const ruta = path.join(salida, 'e2e-export-vista-fugas.png');
  if (fs.existsSync(ruta)) {
    const b = fs.readFileSync(ruta);
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    const vp = pagina.viewportSize();
    console.log(`· vista exportada: ${w}×${h} (proporción ${(w / h).toFixed(3)}; pantalla ${(vp.width / vp.height).toFixed(3)})`);
  }
}
await pagina.click('#btn-vista'); // volver a la foto
await pagina.waitForTimeout(300);

// modo B y tocar la línea más larga de la primera familia
await pagina.click('#btn-ajustes');
await pagina.check('input[name="modo"][value="B"]');
await pagina.check('#aj-registro');
await pagina.click('#btn-cerrar-ajustes');
const objetivo = await pagina.evaluate(() => window.__depuracion?.puntoDeLinea?.());
if (objetivo) await pagina.mouse.click(objetivo[0], objetivo[1]);
await pagina.waitForTimeout(400);
await paso('4-modoB-linea');

// arrastrar el horizonte 60 px hacia abajo
const hz = await pagina.evaluate(() => window.__depuracion?.puntoHorizonte?.());
if (hz) {
  await pagina.mouse.move(hz[0], hz[1]);
  await pagina.mouse.down();
  await pagina.mouse.move(hz[0], hz[1] + 60, { steps: 6 });
  await pagina.mouse.up();
  await pagina.waitForTimeout(300);
}
await paso('5-horizonte-movido');

// cargar una foto
await pagina.setInputFiles('#archivo', rutaFachada);
await pagina.waitForTimeout(3000);
await paso('6-foto');

// exportar
const descargas = [];
pagina.on('download', (d) => descargas.push(d));
await pagina.click('#btn-exportar');
await pagina.waitForTimeout(2000);
for (const d of descargas) {
  const destino = path.join(salida, `e2e-export-${d.suggestedFilename().endsWith('.json') ? 'registro.json' : 'imagen.png'}`);
  await d.saveAs(destino);
}
console.log('· exportados:', descargas.map((d) => d.suggestedFilename()).join(', ') || '(ninguno)');
const reg = path.join(salida, 'e2e-export-registro.json');
if (fs.existsSync(reg)) {
  const j = JSON.parse(fs.readFileSync(reg, 'utf8'));
  console.log('· registro:', JSON.stringify({ modo: j.modo, origen: j.origen, focal: j.camara, puntos: j.puntosFuga.map((p) => `${p.etiqueta}:${p.tipo}:${p.residualMedioGrados}°`), horizonte: j.horizonte?.fuente }));
}

// sin conexión: el service worker no se registra en http://localhost sin https en todas las versiones; se comprueba aparte
console.log(errores.length ? `\nERRORES:\n${errores.join('\n')}` : '\nSin errores en la consola.');
await navegador.close();
servidor.close();
process.exit(errores.length ? 1 : 0);
