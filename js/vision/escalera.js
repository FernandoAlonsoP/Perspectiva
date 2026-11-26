// =============================================================================
// escalera.js — pendiente de una escalera vista de frente.
//
// De frente, una escalera no tiene aristas inclinadas continuas: las narices
// de los peldaños son horizontales. La pendiente existe solo como ALINEACIÓN
// de los extremos de esas narices (la «línea de narices»). Es una recta
// virtual que el dibujante construye, y es paralela a la pendiente.
//
// Geometría: la fuga de la pendiente está alineada con la fuga de su planta y
// la fuga vertical. Cada línea de narices se corta con esa recta en la fuga de
// la pendiente; se acepta si el ángulo resultante es plausible para una
// escalera y si las dos líneas (izquierda y derecha), cuando existen, coinciden.
// =============================================================================

import { cruz, normalizar, aImagen, aCartesiano, GRADOS, punto3 } from './geometria.js';
import { imagenAEsfera } from './manhattan.js';

function anguloEntre(a, b) {
  return Math.acos(Math.min(1, Math.abs(punto3(normalizar(a), normalizar(b))))) * GRADOS;
}

/** Recta (a, b, c) normalizada para que |(a, b)| = 1: a·x + b·y + c = distancia con signo. */
/** Recta ajustada por mínimos cuadrados totales a una nube de puntos. */
function rectaAjustada(ps) {
  const n = ps.length;
  const mx = ps.reduce((t, p) => t + p[0], 0) / n, my = ps.reduce((t, p) => t + p[1], 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of ps) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);          // dirección principal
  const a = -Math.sin(th), b = Math.cos(th);                 // normal
  return [a, b, -(a * mx + b * my)];
}

function rectaPor(p, q) {
  const l = cruz([p[0], p[1], 1], [q[0], q[1], 1]);
  const n = Math.hypot(l[0], l[1]) || 1;
  return [l[0] / n, l[1] / n, l[2] / n];
}

/**
 * @returns null o { v, pendiente, vPlanta, virtuales: [[x1,y1,x2,y2]...], extremos }
 */
export function buscarEscaleraFrontal(segmentos, n, familias, cam, cfg, lado, rng) {
  const ver = familias.find((f) => f.tipo === 'vertical');
  if (!ver) return null;
  const hor = familias.filter((f) => f.tipo === 'horizontal');
  if (hor.length < 1) return null;
  const V = aImagen(ver.v, cam);
  let mejor = null;

  for (const N of hor) {                       // familia de las narices
    const k = familias.indexOf(N);
    // dirección de las narices en la imagen (para ordenar los extremos)
    const PN = aImagen(N.v, cam);
    const tramos = [];
    for (const i of N.inliers) {
      const x1 = segmentos[i * 4], y1 = segmentos[i * 4 + 1], x2 = segmentos[i * 4 + 2], y2 = segmentos[i * 4 + 3];
      const L = Math.hypot(x2 - x1, y2 - y1);
      if (L < cfg.escaleraLongitudMinRel * lado) continue;
      // ordenar extremos: «izquierdo» = el más alejado de la fuga de las narices en su sentido
      const c1 = aCartesiano(PN);
      let a = [x1, y1], b = [x2, y2];
      if (c1) { if (Math.hypot(a[0] - c1[0], a[1] - c1[1]) < Math.hypot(b[0] - c1[0], b[1] - c1[1])) [a, b] = [b, a]; }
      else if (a[0] * PN[0] + a[1] * PN[1] > b[0] * PN[0] + b[1] * PN[1]) [a, b] = [b, a];
      tramos.push({ i, a, b, my: (y1 + y2) / 2 });
    }
    if (tramos.length < cfg.escaleraMinPeldanos) continue;

    // dirección de la planta: otra horizontal detectada o, si no la hay, la
    // perpendicular a las narices y a la vertical (está determinada por la geometría)
    const plantas = hor.filter((P) => P !== N);
    if (!plantas.length) plantas.push({ v: normalizar(cruz(N.v, ver.v)), prevista: true });
    for (const P of plantas) {                 // familia de la planta (dirección del tramo)
      const Lp = cruz(aImagen(P.v, cam), V);   // recta fuga de la planta – fuga vertical
      const lados = [];
      for (const lado2 of ['a', 'b']) {
        const pts = tramos.map((t) => ({ p: t[lado2], t }));
        let mejorL = null;
        const tol = Math.max(cfg.escaleraTolPx, cfg.escaleraTolRel * lado);
        for (let it = 0; it < cfg.escaleraIteraciones; it++) {
          const u = pts[Math.floor(rng() * pts.length)], w = pts[Math.floor(rng() * pts.length)];
          if (u === w || Math.abs(u.p[1] - w.p[1]) < 3 * tol) continue;
          const l = rectaPor(u.p, w.p);
          const ins = pts.filter((q) => Math.abs(l[0] * q.p[0] + l[1] * q.p[1] + l[2]) < tol);
          // peldaños distintos: alturas separadas
          const ys = ins.map((q) => q.p[1]).sort((x, y) => x - y);
          let distintos = ys.length ? 1 : 0;
          for (let j = 1; j < ys.length; j++) if (ys[j] - ys[j - 1] > tol) distintos++;
          if (distintos < cfg.escaleraMinPeldanos) continue;
          // ajuste con todos los extremos alineados (no solo los dos de la muestra)
          const lr = rectaAjustada(ins.map((q) => q.p));
          const insR = pts.filter((q) => Math.abs(lr[0] * q.p[0] + lr[1] * q.p[1] + lr[2]) < tol);
          const lf = insR.length >= ins.length ? rectaAjustada(insR.map((q) => q.p)) : lr;
          const Q = cruz(lf, Lp);
          if (Math.hypot(Q[0], Q[1], Q[2]) < 1e-12) continue;
          const vq = imagenAEsfera(Q, cam);
          if (anguloEntre(vq, ver.v) < 3) continue;          // es la vertical (cantos de muro)
          const pendiente = 90 - anguloEntre(vq, ver.v);
          if (pendiente < cfg.escaleraPendienteMin || pendiente > cfg.escaleraPendienteMax) continue;
          if (!mejorL || distintos > mejorL.distintos) mejorL = { l: lf, ins, distintos, vq, pendiente };
        }
        if (mejorL) lados.push(mejorL);
      }
      if (!lados.length) continue;
      // con dos líneas de narices, deben dar la misma pendiente
      let elegidos = lados;
      if (lados.length === 2 && Math.abs(lados[0].pendiente - lados[1].pendiente) > cfg.escaleraAcuerdo) {
        elegidos = [lados[0].distintos >= lados[1].distintos ? lados[0] : lados[1]];
      }
      const total = elegidos.reduce((t, x) => t + x.distintos, 0);
      if (mejor && total <= mejor.total) continue;
      // fuga final: media de las direcciones (en el mismo sentido), sobre la recta planta–vertical
      let v = [0, 0, 0];
      for (const x of elegidos) { const s = punto3(x.vq, elegidos[0].vq) < 0 ? -1 : 1; v = v.map((c, j) => c + s * x.vq[j]); }
      v = normalizar(v);
      if (v[2] < 0) v = v.map((c) => -c);
      const virtuales = elegidos.map((x) => {
        const ps = x.ins.map((q) => q.p).sort((p, q) => p[1] - q[1]);
        return [ps[0][0], ps[0][1], ps[ps.length - 1][0], ps[ps.length - 1][1]];
      });
      mejor = {
        total, v, vPlanta: P.v, virtuales, kNarices: k,
        pendiente: elegidos.reduce((t, x) => t + x.pendiente, 0) / elegidos.length,
      };
    }
  }
  return mejor;
}
