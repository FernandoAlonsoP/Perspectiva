// =============================================================================
// interaccion.js — gestos sobre la imagen congelada:
//   · arrastrar un punto de fuga (o su flecha, si está fuera de la pantalla)
//   · arrastrar el horizonte
//   · tocar una línea (modo B) para ver su desviación
// =============================================================================

import { moverPuntoFuga, moverHorizonte } from './edicion.js';
import { aCartesiano } from './vision/geometria.js';

/**
 * @param lienzo  <canvas>
 * @param app     { resultado(): r, transformacion(): T, editable(): bool,
 *                  modo(): 'A'|'B', seleccionar(i), cambiado() }
 */
export function instalarInteraccion(lienzo, app) {
  let arrastre = null;
  const dpr = () => window.devicePixelRatio || 1;

  // píxel del lienzo, ya en coordenadas lógicas (deshecho el giro de la pantalla)
  const aLienzo = (e) => {
    const rect = lienzo.getBoundingClientRect();
    const p = [(e.clientX - rect.left) * dpr(), (e.clientY - rect.top) * dpr()];
    return app.aLogico ? app.aLogico(p) : p;
  };
  const aImagen = (T, p) => [(p[0] - T.ox) / T.escala, (p[1] - T.oy) / T.escala];

  lienzo.addEventListener('pointerdown', (e) => {
    const r = app.resultado();
    if (!r || !app.editable()) return;
    const T = app.transformacion();
    const p = aLienzo(e);
    const radio = 34 * dpr();

    // 1. ¿Un punto de fuga o su flecha?
    let mejor = -1, dmin = radio;
    r.familias.forEach((f, k) => {
      const q = f._pantalla || f._flecha;
      if (!q) return;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < dmin) { dmin = d; mejor = k; }
    });
    if (mejor >= 0) {
      const f = r.familias[mejor];
      const enPantalla = !!f._pantalla;
      // un punto lejano o en el infinito se convierte en uno finito y lejano para poder moverlo
      let c = aCartesiano(f.punto);
      if (!c || Math.hypot(c[0] - r.ancho / 2, c[1] - r.alto / 2) > 30 * r.ancho) {
        const d = [f.punto[0], f.punto[1]], n = Math.hypot(d[0], d[1]) || 1;
        c = [r.ancho / 2 + (d[0] / n) * 30 * r.ancho, r.alto / 2 + (d[1] / n) * 30 * r.ancho];
        if (f._flecha) {
          // elegir el sentido de la flecha tocada
          const fi = aImagen(T, f._flecha);
          if ((fi[0] - r.ancho / 2) * (c[0] - r.ancho / 2) + (fi[1] - r.alto / 2) * (c[1] - r.alto / 2) < 0) {
            c = [r.ancho - c[0], r.alto - c[1]];
          }
        }
      }
      arrastre = { tipo: 'punto', k: mejor, origen: aImagen(T, p), inicio: c, enPantalla };
      lienzo.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // 2. ¿El horizonte?
    if (r.horizonte) {
      const [a, b, c] = r.horizonte.linea;
      const q = aImagen(T, p);
      const d = Math.abs(a * q[0] + b * q[1] + c) / Math.hypot(a, b);
      if (d * T.escala < 24 * dpr()) {
        arrastre = { tipo: 'horizonte', ultimo: q };
        lienzo.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }

    // 3. Modo B: tocar una línea
    if (app.modo() === 'B') {
      const q = aImagen(T, p);
      let sel = null, dsel = (26 * dpr()) / T.escala;
      const n = r.segmentos.length / 4;
      for (let i = 0; i < n; i++) {
        if (r.familiaSeg[i] < 0) continue;
        const d = distanciaSegmento(q, r.segmentos, i);
        if (d < dsel) { dsel = d; sel = i; }
      }
      app.seleccionar(sel);
    }
  });

  lienzo.addEventListener('pointermove', (e) => {
    if (!arrastre) return;
    const r = app.resultado();
    const T = app.transformacion();
    const q = aImagen(T, aLienzo(e));
    if (arrastre.tipo === 'punto') {
      let dx = q[0] - arrastre.origen[0], dy = q[1] - arrastre.origen[1];
      if (!arrastre.enPantalla) {
        // un punto lejano se mueve más rápido: proporcional a su distancia
        const dist = Math.hypot(arrastre.inicio[0] - r.ancho / 2, arrastre.inicio[1] - r.alto / 2);
        const k = Math.max(1, dist / (r.ancho / 2));
        dx *= k; dy *= k;
      }
      moverPuntoFuga(r, arrastre.k, arrastre.inicio[0] + dx, arrastre.inicio[1] + dy);
    } else {
      const [a, b] = r.horizonte.linea;
      const n = Math.hypot(a, b) || 1;
      const d = ((q[0] - arrastre.ultimo[0]) * a + (q[1] - arrastre.ultimo[1]) * b) / n;
      moverHorizonte(r, d);
      arrastre.ultimo = q;
    }
    app.cambiado();
  });

  const fin = () => { arrastre = null; };
  lienzo.addEventListener('pointerup', fin);
  lienzo.addEventListener('pointercancel', fin);
}

function distanciaSegmento(p, s, i) {
  const x1 = s[i * 4], y1 = s[i * 4 + 1], x2 = s[i * 4 + 2], y2 = s[i * 4 + 3];
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / L2));
  return Math.hypot(p[0] - (x1 + t * dx), p[1] - (y1 + t * dy));
}
