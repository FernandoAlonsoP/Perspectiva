// Analiza las fotos de test/fotos/ (no se suben al repositorio) y dibuja el resultado.
import { analizar } from '../js/vision/analisis.js';
import { prepararGris } from '../js/vision/preparar.js';
import { dibujarSuperposicion } from '../js/overlay.js';
import { CONFIG } from '../js/config.js';

const nombres = new URLSearchParams(location.search).get('fotos').split(',');
const salida = [];
for (const n of nombres) {
  const img = new Image();
  img.src = `./fotos/${n}`;
  await img.decode();
  const g = prepararGris(img, img.naturalWidth, img.naturalHeight, CONFIG.ladoAnalisisAlto);
  const r = analizar(g.gris, g.ancho, g.alto, { calidad: 'alto', escala: g.escala });
  // ?alejar=N: vista alejada (como «Ver fugas») para ver los puntos de fuga fuera de la foto
  const k = Number(new URLSearchParams(location.search).get('alejar') || 1);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth * 1.6; c.height = img.naturalHeight * 1.2;
  const s = 1 / k;
  const T = { escala: s, ox: c.width / 2 - (img.naturalWidth / 2) * s, oy: c.height / 2 - (img.naturalHeight / 2) * s };
  if (k === 1) { c.width = img.naturalWidth; c.height = img.naturalHeight; T.ox = 0; T.oy = 0; }
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, T.ox, T.oy, img.naturalWidth * s, img.naturalHeight * s);
  dibujarSuperposicion(ctx, r, T, { modo: 'A', g: 2 });
  salida.push({
    foto: n,
    focalMM: +r.focalMM.toFixed(1), fuenteFocal: r.fuenteFocal,
    familias: r.familias.map((f) => {
      const x = f.punto[2] ? (f.punto[0] / f.punto[2]).toFixed(0) : '∞', y = f.punto[2] ? (f.punto[1] / f.punto[2]).toFixed(0) : '∞';
      return `${f.etiqueta || f.tipo}[${f.tipo}${f.pendiente ? ' ' + f.pendiente.toFixed(0) + '°' : ''}] n=${f.nSegmentos} pf=(${x},${y}) v=${f.v.map((a) => a.toFixed(2))}`;
    }),
    horizonte: r.horizonte?.fuente ?? null,
    comprobacion: r.comprobacion,
    imagen: c.toDataURL('image/jpeg', 0.8),
  });
}
window.__resultado = salida;
