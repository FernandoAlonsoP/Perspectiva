// =============================================================================
// edicion.js — modo exploración: el alumno arrastra un punto de fuga o el
// horizonte y ve cómo cambia el encaje. También crea guías manuales cuando la
// imagen no tiene líneas fiables.
// =============================================================================

import { errorAngular, cruz, normalizar, aEsfera, rectaDesdeNormal } from './vision/geometria.js';

/** Recalcula la desviación de cada segmento respecto al punto de fuga de su familia. */
export function recalcularResiduales(r) {
  const n = r.segmentos.length / 4;
  const suma = r.familias.map(() => 0), cuenta = r.familias.map(() => 0);
  for (let i = 0; i < n; i++) {
    const k = r.familiaSeg[i];
    if (k < 0 || k >= r.familias.length) continue;
    const x1 = r.segmentos[i * 4], y1 = r.segmentos[i * 4 + 1], x2 = r.segmentos[i * 4 + 2], y2 = r.segmentos[i * 4 + 3];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    const e = errorAngular((x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) / L, (y2 - y1) / L, r.familias[k].punto);
    r.residualSeg[i] = e;
    suma[k] += e; cuenta[k]++;
  }
  r.familias.forEach((f, k) => {
    f.residualMedio = cuenta[k] ? suma[k] / cuenta[k] : 0;
    f.nSegmentos = cuenta[k];
  });
}

/** Horizonte por dos puntos horizontales (si los hay y no se ha movido a mano). */
function actualizarHorizonte(r) {
  if (r.horizonte?.manual) return;
  const hor = r.familias.filter((f) => f.tipo === 'horizontal');
  if (hor.length >= 2) {
    const l = cruz(hor[0].punto, hor[1].punto);
    r.horizonte = { linea: l, normal: null, fuente: 'dos puntos de fuga horizontales' };
  }
}

/** Mueve el punto de fuga k a la posición (x, y) de la imagen. */
export function moverPuntoFuga(r, k, x, y) {
  const f = r.familias[k];
  f.punto = [x, y, 1];
  f.v = normalizar(aEsfera(x, y, r.cam));
  f.manual = true;
  recalcularResiduales(r);
  actualizarHorizonte(r);
}

/** Desplaza el horizonte en perpendicular una distancia d (px de imagen). */
export function moverHorizonte(r, d) {
  if (!r.horizonte) return;
  const [a, b, c] = r.horizonte.linea;
  const n = Math.hypot(a, b) || 1;
  r.horizonte = { ...r.horizonte, linea: [a / n, b / n, c / n - d], manual: true };
}

/**
 * Resultado "vacío" con guías manuales: horizonte (del sensor o a media altura)
 * y dos puntos de fuga sobre él, fuera de la imagen, para arrastrar.
 */
export function guiasManuales(ancho, alto, arriba, focalPx) {
  const cam = { f: focalPx, cx: ancho / 2, cy: alto / 2 };
  let linea = arriba ? rectaDesdeNormal(normalizar(arriba), cam) : [0, 1, -alto / 2];
  if (Math.abs(linea[1]) < 1e-9) linea = [0, 1, -alto / 2];
  const yEn = (x) => -(linea[0] * x + linea[2]) / linea[1];
  const familias = [-0.3 * ancho, 1.3 * ancho].map((x) => ({
    punto: [x, yEn(x), 1],
    v: normalizar(aEsfera(x, yEn(x), cam)),
    tipo: 'horizontal',
    nSegmentos: 0,
    residualMedio: 0,
    manual: true,
  }));
  return {
    ancho, alto, cam,
    focalMM: null, fuenteFocal: 'por defecto',
    segmentos: new Float32Array(0), familiaSeg: new Int8Array(0), residualSeg: new Float32Array(0),
    familias,
    horizonte: { linea, normal: null, fuente: arriba ? 'sensor' : 'estimado (a media altura)', manual: false },
    horizonteSensor: null,
    fiable: false,
    manual: true,
    mensaje: 'Guías manuales: arrastra los puntos de fuga y el horizonte.',
  };
}
