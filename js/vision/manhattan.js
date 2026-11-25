// =============================================================================
// manhattan.js — de los puntos de fuga a la estructura de la escena.
//
// "Mundo Manhattan" (Coughlan y Yuille, 1999): la arquitectura suele organizarse
// en tres direcciones perpendiculares (dos horizontales y la vertical). Si dos
// puntos de fuga corresponden a direcciones perpendiculares, su posición en la
// imagen permite calcular la focal de la cámara:
//
//        f² = −(v₁ − c) · (v₂ − c)      (c = centro de la imagen)
//
// Con la focal, cada punto de fuga se convierte en una dirección 3D, y podemos
// decir cuál es vertical, cuáles horizontales y dónde está el horizonte (la
// recta de la imagen donde se proyectan todas las direcciones horizontales).
// =============================================================================

import { cruz, normalizar, punto3, aImagen, aCartesiano, rectaDesdeNormal, GRADOS, mmAPx, pxAMm } from './geometria.js';

/** Punto homogéneo de la imagen → dirección en la esfera con la cámara dada. */
export function imagenAEsfera(V, cam) {
  return normalizar([(V[0] - cam.cx * V[2]) / cam.f, (V[1] - cam.cy * V[2]) / cam.f, V[2]]);
}

/**
 * Estima la focal (px) a partir de pares de puntos de fuga finitos.
 * Devuelve { f, par: [i, j] } o null si ningún par da un valor plausible.
 */
export function estimarFocal(familias, cam0, ancho, alto, cfg) {
  const fMin = mmAPx(cfg.focalMinMM, ancho, alto);
  const fMax = mmAPx(cfg.focalMaxMM, ancho, alto);
  const lado = Math.max(ancho, alto);
  let mejor = null;
  for (let i = 0; i < familias.length; i++) {
    for (let j = i + 1; j < familias.length; j++) {
      const p1 = aCartesiano(aImagen(familias[i].v, cam0));
      const p2 = aCartesiano(aImagen(familias[j].v, cam0));
      if (!p1 || !p2) continue;
      // puntos muy lejanos (casi paralelas) no dan información fiable de la focal
      if (Math.hypot(p1[0] - cam0.cx, p1[1] - cam0.cy) > 20 * lado) continue;
      if (Math.hypot(p2[0] - cam0.cx, p2[1] - cam0.cy) > 20 * lado) continue;
      const f2 = -((p1[0] - cam0.cx) * (p2[0] - cam0.cx) + (p1[1] - cam0.cy) * (p2[1] - cam0.cy));
      if (f2 <= 0) continue;
      const f = Math.sqrt(f2);
      if (f < fMin || f > fMax) continue;
      const apoyo = Math.min(familias[i].longitud, familias[j].longitud);
      if (!mejor || apoyo > mejor.apoyo) mejor = { f, par: [i, j], apoyo };
    }
  }
  return mejor;
}

/**
 * Clasifica cada familia como 'vertical', 'horizontal' o 'inclinada'.
 * arriba: vector "hacia arriba" en coordenadas de cámara (del sensor) o null.
 */
export function clasificar(familias, arriba, cfg) {
  const cosV = Math.cos(cfg.toleranciaVertical / GRADOS);
  const senH = Math.sin(cfg.toleranciaHorizontal / GRADOS);
  // sin sensor suponemos cámara casi vertical: "arriba" ≈ −y de la imagen
  const ref = arriba ? normalizar(arriba) : [0, -1, 0];
  const cosVsin = arriba ? cosV : Math.cos(30 / GRADOS); // más tolerante sin sensor

  let iVertical = -1, mejor = 0;
  familias.forEach((fam, i) => {
    const c = Math.abs(punto3(fam.v, ref));
    if (c > cosVsin && c > mejor) { mejor = c; iVertical = i; }
  });
  const refH = iVertical >= 0 ? familias[iVertical].v : ref;
  const senHuso = arriba || iVertical >= 0 ? senH : Math.sin(35 / GRADOS);
  familias.forEach((fam, i) => {
    if (i === iVertical) fam.tipo = 'vertical';
    else fam.tipo = Math.abs(punto3(fam.v, refH)) < senHuso ? 'horizontal' : 'inclinada';
  });
}

/**
 * Calcula la línea del horizonte de la escena. Orden de preferencia:
 *  1. Dos familias horizontales: la recta que une sus puntos de fuga.
 *  2. Una horizontal + vertical (o sensor): pasa por el punto horizontal y es
 *     perpendicular (en 3D) a la vertical.
 *  3. Solo vertical (o solo sensor): perpendicular a la vertical.
 *  4. Una horizontal sin más datos: horizontal en la imagen por ese punto (estimado).
 * Devuelve { normal, fuente } con normal en la esfera, o null.
 */
export function calcularHorizonte(familias, arriba) {
  const hor = familias.filter((f) => f.tipo === 'horizontal');
  const ver = familias.find((f) => f.tipo === 'vertical');
  const vertical = ver ? ver.v : arriba ? normalizar(arriba) : null;
  const origen = ver ? 'verticales' : 'sensor';

  if (hor.length >= 2) {
    return { normal: normalizar(cruz(hor[0].v, hor[1].v)), fuente: 'dos puntos de fuga horizontales' };
  }
  if (hor.length === 1 && vertical) {
    const h = hor[0].v;
    const g = normalizar([
      vertical[0] - punto3(vertical, h) * h[0],
      vertical[1] - punto3(vertical, h) * h[1],
      vertical[2] - punto3(vertical, h) * h[2],
    ]);
    return { normal: g, fuente: `punto de fuga + ${origen}` };
  }
  if (vertical) return { normal: normalizar(vertical), fuente: origen };
  if (hor.length === 1) {
    // recta horizontal de la imagen que pasa por el punto de fuga: normal ⟂ a v y al eje x
    return { normal: normalizar(cruz(hor[0].v, [1, 0, 0])), fuente: 'estimado (sin vertical)' };
  }
  return null;
}

/** Horizonte "esperado" según el sensor (recta en la imagen) o null. */
export function horizonteSensor(arriba, cam) {
  if (!arriba) return null;
  return rectaDesdeNormal(normalizar(arriba), cam);
}

export { pxAMm };
