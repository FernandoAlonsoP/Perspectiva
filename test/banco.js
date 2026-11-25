// =============================================================================
// banco.js — banco de pruebas: genera las escenas sintéticas, las analiza con
// el mismo código que la app y mide el error frente a la geometría conocida.
// Se abre con banco.html (lo lanza test/ejecutar.mjs en un navegador sin pantalla).
// =============================================================================

import { ESCENAS, generar } from './escenas.js';
import { analizar } from '../js/vision/analisis.js';
import { prepararGris } from '../js/vision/preparar.js';
import { anguloDirecciones, normalizar } from '../js/vision/geometria.js';
import { imagenAEsfera } from '../js/vision/manhattan.js';
import { CONFIG } from '../js/config.js';

let dibujarSuperposicion = null;
try { ({ dibujarSuperposicion } = await import('../js/overlay.js')); } catch { /* aún no existe */ }

function evaluar(r, verdad, ancho, alto) {
  if (!verdad) return { ejes: null, horizonte: null };
  const camV = { f: verdad.focalPx, cx: ancho / 2, cy: alto / 2 };
  const dirs = r.familias.map((f) => imagenAEsfera(f.punto, camV));
  const ejes = {};
  for (const [nombre, d] of Object.entries(verdad.ejes)) {
    ejes[nombre] = dirs.length ? Math.min(...dirs.map((v) => anguloDirecciones(v, d))) : null;
  }
  let horizonte = null;
  if (r.horizonte) {
    const [a, b, c] = r.horizonte.linea;
    const N = normalizar([a * camV.f, b * camV.f, a * camV.cx + b * camV.cy + c]);
    horizonte = anguloDirecciones(N, verdad.ejes.vertical);
  }
  return { ejes, horizonte };
}

const salida = [];
const soloGenerar = location.search.includes('solo-generar');
for (const escena of soloGenerar ? [] : ESCENAS) {
  const { lienzo, verdad } = generar(escena);
  for (const variante of ['sin sensor', 'con sensor']) {
    if (variante === 'con sensor' && !verdad) continue;
    for (const calidad of ['vivo', 'alto']) {
      const lado = calidad === 'alto' ? CONFIG.ladoAnalisisAlto : CONFIG.ladoAnalisisVivo;
      const g = prepararGris(lienzo, lienzo.width, lienzo.height, lado);
      const arriba = variante === 'con sensor' ? verdad.ejes.vertical.map((x) => -x) : null;
      const r = analizar(g.gris, g.ancho, g.alto, { calidad, escala: g.escala, arriba });
      const ev = evaluar(r, verdad, lienzo.width, lienzo.height);
      let imagen = null;
      if (dibujarSuperposicion && calidad === 'alto' && variante === 'sin sensor') {
        const c = document.createElement('canvas');
        c.width = lienzo.width; c.height = lienzo.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(lienzo, 0, 0);
        dibujarSuperposicion(ctx, r, { escala: 1, ox: 0, oy: 0 }, { modo: 'B', rejilla: false, aristas: false, anchoLienzo: c.width, altoLienzo: c.height });
        imagen = c.toDataURL('image/jpeg', 0.85);
      }
      salida.push({
        escena: escena.nombre, variante, calidad,
        familias: r.familias.map((f) => `${f.tipo}(${f.nSegmentos}, L${f.longitudRel.toFixed(1)}, d${f.rectasDistintas}, %${(f.fraccion*100).toFixed(0)}, ${f.residualMedio.toFixed(2)}°)`),
        focalMM: +r.focalMM.toFixed(1), fuenteFocal: r.fuenteFocal,
        errorEjes: ev.ejes, errorHorizonte: ev.horizonte, horizonteFuente: r.horizonte?.fuente ?? null,
        fiable: r.fiable, mensaje: r.mensaje, comprobacion: r.comprobacion,
        segmentos: r.nSegmentos, ms: Math.round(r.tiempos.total),
        imagen,
      });
    }
  }
}
window.__resultado = salida;
