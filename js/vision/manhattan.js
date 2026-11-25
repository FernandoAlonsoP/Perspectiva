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

  // dos horizontales solo si son de verdad perpendiculares (si no, alguna está mal medida)
  if (hor.length >= 2 && (!vertical || Math.abs(90 - Math.acos(Math.min(1, Math.abs(punto3(hor[0].v, hor[1].v)))) * GRADOS) < 5)) {
    return { normal: normalizar(cruz(hor[0].v, hor[1].v)), fuente: 'dos puntos de fuga horizontales' };
  }
  if (hor.length >= 1 && vertical) {
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

// =============================================================================
// Estructura de la escena con pendientes (escaleras, rampas, cubiertas).
//
// Una escalera añade una CUARTA dirección, la de su pendiente, que no es
// perpendicular a las demás. Si se la trata como "Manhattan", la focal sale
// mal y todo lo demás también. Aquí:
//   1. la vertical se reconoce en la IMAGEN (o con el sensor), sin focal;
//   2. la focal se elige por coherencia: la que hace perpendiculares a la
//      vertical el mayor número de líneas, con preferencia por focales de móvil;
//   3. lo que no es vertical ni horizontal es una PENDIENTE: su punto de fuga
//      está en la vertical del punto de fuga de su planta (geometría descriptiva).
// =============================================================================

function anguloImagenVertical(datos, inliers) {
  const a = inliers.map((i) => Math.acos(Math.min(1, Math.abs(datos[i].dy))) * GRADOS).sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : 90;
}

/** Ángulo (grados) entre dos rectas de la imagen dadas por sus direcciones (sin sentido). */
function anguloRectas2D(a, b) {
  const n = Math.hypot(a[0], a[1]) * Math.hypot(b[0], b[1]) || 1;
  return Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1]) / n)) * GRADOS;
}

/** Índice de la familia vertical, o -1. Solo usa la imagen (y el sensor si lo hay). */
function buscarVertical(familias, puntos, datos, cam, arriba, cfg) {
  let mejor = -1, apoyo = 0;
  familias.forEach((f, k) => {
    if (anguloImagenVertical(datos, f.inliers) > cfg.verticalImagenGrados) return;
    const P = puntos[k];
    const dir = Math.abs(P[2]) < 1e-9 ? [P[0], P[1]] : [P[0] / P[2] - cam.cx, P[1] / P[2] - cam.cy];
    if (Math.abs(dir[1]) < Math.abs(dir[0])) return;           // su punto de fuga debe estar arriba o abajo
    if (arriba && Math.hypot(arriba[0], arriba[1]) > 0.05 &&
        anguloRectas2D(dir, [arriba[0], arriba[1]]) > cfg.verticalSensorGrados) return;
    if (f.longitud > apoyo) { apoyo = f.longitud; mejor = k; }
  });
  return mejor;
}

/**
 * Resuelve focal, vertical, horizontales y pendientes.
 * familias: [{ v, inliers, longitud }] con v calculado con `cam`.
 * Devuelve { cam, fuenteFocal } y deja en cada familia: v, tipo, y si es
 * pendiente: pendiente (grados) y vPlanta (dirección horizontal de su planta).
 */
export function resolverEstructura(familias, datos, cam, ancho, alto, arriba, cfg, focalFija) {
  const puntos = familias.map((f) => aImagen(f.v, cam));
  const g = arriba ? normalizar(arriba) : null;
  const iV = buscarVertical(familias, puntos, datos, cam, g, cfg);
  let fuenteFocal = focalFija ? null : 'por defecto';

  if (!focalFija) {
    const f0 = mmAPx(cfg.focalDefectoMM, ancho, alto);
    const fMin = mmAPx(cfg.focalMinMM, ancho, alto), fMax = mmAPx(cfg.focalMaxMM, ancho, alto);
    const lado = Math.max(ancho, alto);
    const cand = [{ f: f0, fuente: 'por defecto' }];
    const cart = puntos.map((P) => aCartesiano(P));
    for (let i = 0; i < familias.length; i++) for (let j = i + 1; j < familias.length; j++) {
      const p1 = cart[i], p2 = cart[j];
      if (!p1 || !p2) continue;
      if (Math.hypot(p1[0] - cam.cx, p1[1] - cam.cy) > 20 * lado || Math.hypot(p2[0] - cam.cx, p2[1] - cam.cy) > 20 * lado) continue;
      const f2 = -((p1[0] - cam.cx) * (p2[0] - cam.cx) + (p1[1] - cam.cy) * (p2[1] - cam.cy));
      if (f2 > 0 && Math.sqrt(f2) > fMin && Math.sqrt(f2) < fMax) cand.push({ f: Math.sqrt(f2), fuente: 'escena' });
    }
    // con el móvil inclinado, el sensor y el punto de fuga vertical dan la focal directamente
    if (g && iV >= 0 && cart[iV] && Math.abs(g[2]) > Math.sin(4 / GRADOS)) {
      const d = Math.hypot(cart[iV][0] - cam.cx, cart[iV][1] - cam.cy);
      const f = (d * Math.abs(g[2])) / Math.hypot(g[0], g[1]);
      if (f > fMin && f < fMax) cand.push({ f, fuente: 'escena + sensor' });
    }
    const sigma = Math.log(cfg.focalDispersion);
    let mejor = null;
    for (const c of cand) {
      const camC = { ...cam, f: c.f };
      const dirs = puntos.map((P) => imagenAEsfera(P, camC));
      const ref = iV >= 0 ? dirs[iV] : g;
      let apoyo = 0;
      if (ref) {
        familias.forEach((fam, k) => {
          if (k !== iV && Math.abs(90 - anguloEntre(dirs[k], ref)) < cfg.toleranciaManhattan) apoyo += fam.longitud;
        });
      }
      for (let i = 0; i < familias.length; i++) for (let j = i + 1; j < familias.length; j++) {
        if (i === iV || j === iV) continue;
        if (Math.abs(90 - anguloEntre(dirs[i], dirs[j])) < cfg.toleranciaManhattan) apoyo += Math.min(familias[i].longitud, familias[j].longitud);
      }
      if (g && iV >= 0 && anguloEntre(dirs[iV], g) < 4) apoyo *= 1.5;
      const prior = Math.exp(-((Math.log(c.f / f0) / sigma) ** 2) / 2);
      const puntuacion = (apoyo + 1e-3) * prior;
      if (!mejor || puntuacion > mejor.puntuacion) mejor = { ...c, puntuacion };
    }
    cam = { ...cam, f: mejor.f };
    fuenteFocal = mejor.fuente;
  }
  familias.forEach((f, k) => { f.v = imagenAEsfera(puntos[k], cam); });

  // Clasificación
  const ref = iV >= 0 ? familias[iV].v : g;
  if (!ref) {
    clasificar(familias, null, cfg);          // sin vertical ni sensor: criterio aproximado
  } else {
    familias.forEach((f, k) => {
      f.pendiente = undefined; f.vPlanta = undefined;
      if (k === iV) { f.tipo = 'vertical'; return; }
      const inclinacion = Math.abs(90 - anguloEntre(f.v, ref));
      if (inclinacion < cfg.toleranciaHorizontal) { f.tipo = 'horizontal'; return; }
      f.tipo = 'inclinada';
      f.pendiente = inclinacion;
      const s = punto3(f.v, ref);
      f.vPlanta = normalizar([f.v[0] - s * ref[0], f.v[1] - s * ref[1], f.v[2] - s * ref[2]]);
    });
    // Una pendiente ARQUITECTÓNICA (escalera, rampa, cubierta) sube en la dirección
    // de una horizontal del edificio o de su perpendicular. Si no (patas abiertas
    // de un taburete, objetos sueltos), se descarta: es ruido para el dibujo.
    const hor = familias.filter((f) => f.tipo === 'horizontal');
    const ejes = hor.map((h) => h.v);
    if (hor.length === 1) ejes.push(normalizar(cruz(hor[0].v, ref)));
    familias.forEach((f) => {
      if (f.tipo !== 'inclinada') return;
      let mejor = 90, eje = null;
      for (const e of ejes) { const a = anguloEntre(f.vPlanta, e); if (a < mejor) { mejor = a; eje = e; } }
      f.alineacionPlanta = mejor;
      if (!ejes.length || mejor > cfg.alineacionPendiente) { f.descartar = true; return; }
      // ninguna escalera ni cubierta tiene menos de ~15°: es una horizontal con error de focal
      if (f.pendiente < cfg.pendienteMinima) { f.tipo = 'horizontal'; f.pendiente = undefined; f.vPlanta = undefined; return; }
      f.vPlanta = eje;   // el PF de la planta es el de esa horizontal (sobre el horizonte)
    });
  }
  return { cam, fuenteFocal };
}

/** Ángulo (grados) entre dos direcciones con sentido ignorado, 0–90. */
function anguloEntre(a, b) {
  return Math.acos(Math.min(1, Math.abs(punto3(normalizar(a), normalizar(b))))) * GRADOS;
}
