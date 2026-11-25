// =============================================================================
// interaccion.js — gestos sobre la imagen congelada:
//   · pellizcar (dos dedos) o rueda del ratón: acercar / alejar
//   · arrastrar con un dedo en zona vacía: desplazar la vista
//   · arrastrar un punto de fuga (o su flecha, si está fuera de la pantalla)
//   · arrastrar el horizonte
//   · tocar una línea (modo B) para ver su desviación
// =============================================================================

import { moverPuntoFuga, moverHorizonte } from './edicion.js';
import { aCartesiano } from './vision/geometria.js';

/**
 * @param lienzo  <canvas>
 * @param app     { resultado(): r, transformacion(): T, editable(): bool, modo(): 'A'|'B',
 *                  seleccionar(i), cambiado(), aLogico(p), vista(): {zoom, cx, cy},
 *                  tamLogico(): {Wl, Hl}, escalaBase(): número }
 */
export function instalarInteraccion(lienzo, app) {
  let arrastre = null;
  const dedos = new Map();      // pointerId → posición lógica
  let pellizco = null;
  const dpr = () => window.devicePixelRatio || 1;
  const ZOOM_MIN = 0.06, ZOOM_MAX = 8;

  // píxel del lienzo, ya en coordenadas lógicas (deshecho el giro de la pantalla)
  const aLienzo = (e) => {
    const rect = lienzo.getBoundingClientRect();
    const p = [(e.clientX - rect.left) * dpr(), (e.clientY - rect.top) * dpr()];
    return app.aLogico ? app.aLogico(p) : p;
  };
  const aImagen = (T, p) => [(p[0] - T.ox) / T.escala, (p[1] - T.oy) / T.escala];

  /** Zoom manteniendo fijo el punto de la imagen que está bajo `p` (coordenadas lógicas). */
  function zoomEn(p, zoomNuevo, puntoImagen) {
    const v = app.vista();
    const { Wl, Hl } = app.tamLogico();
    v.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomNuevo));
    const escala = app.escalaBase() * v.zoom;
    v.cx = puntoImagen[0] - (p[0] - Wl / 2) / escala;
    v.cy = puntoImagen[1] - (p[1] - Hl / 2) / escala;
    app.cambiado();
  }

  lienzo.addEventListener('pointerdown', (e) => {
    const r = app.resultado();
    if (!r || !app.editable()) return;
    const T = app.transformacion();
    const p = aLienzo(e);
    dedos.set(e.pointerId, p);
    lienzo.setPointerCapture(e.pointerId);

    // Dos dedos: pellizco (cancela cualquier otro gesto)
    if (dedos.size === 2) {
      const [a, b] = [...dedos.values()];
      const medio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      pellizco = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, zoom0: app.vista().zoom, puntoImagen: aImagen(T, medio) };
      arrastre = null;
      e.preventDefault();
      return;
    }
    if (dedos.size > 2) return;
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
        e.preventDefault();
        return;
      }
    }

    // 3. Zona vacía: desplazar la vista (o, si no se mueve, tocar una línea en modo B)
    const v = app.vista();
    arrastre = { tipo: 'desplazar', p0: p, c0: [v.cx, v.cy], movido: false };
  });

  lienzo.addEventListener('pointermove', (e) => {
    if (!dedos.has(e.pointerId)) return;
    const p = aLienzo(e);
    dedos.set(e.pointerId, p);
    const r = app.resultado();
    if (!r) return;
    const T = app.transformacion();

    if (pellizco && dedos.size >= 2) {
      const [a, b] = [...dedos.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomEn([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], pellizco.zoom0 * (d / pellizco.d0), pellizco.puntoImagen);
      return;
    }
    if (!arrastre) return;
    const q = aImagen(T, p);
    if (arrastre.tipo === 'punto') {
      let dx = q[0] - arrastre.origen[0], dy = q[1] - arrastre.origen[1];
      if (!arrastre.enPantalla) {
        // un punto lejano se mueve más rápido: proporcional a su distancia
        const dist = Math.hypot(arrastre.inicio[0] - r.ancho / 2, arrastre.inicio[1] - r.alto / 2);
        const k = Math.max(1, dist / (r.ancho / 2));
        dx *= k; dy *= k;
      }
      moverPuntoFuga(r, arrastre.k, arrastre.inicio[0] + dx, arrastre.inicio[1] + dy);
    } else if (arrastre.tipo === 'horizonte') {
      const [a, b] = r.horizonte.linea;
      const n = Math.hypot(a, b) || 1;
      const d = ((q[0] - arrastre.ultimo[0]) * a + (q[1] - arrastre.ultimo[1]) * b) / n;
      moverHorizonte(r, d);
      arrastre.ultimo = q;
    } else if (arrastre.tipo === 'desplazar') {
      const dx = p[0] - arrastre.p0[0], dy = p[1] - arrastre.p0[1];
      if (!arrastre.movido && Math.hypot(dx, dy) < 8 * dpr()) return;
      arrastre.movido = true;
      const v = app.vista();
      v.cx = arrastre.c0[0] - dx / T.escala;
      v.cy = arrastre.c0[1] - dy / T.escala;
    }
    app.cambiado();
  });

  const fin = (e) => {
    const r = app.resultado();
    // un toque sin desplazamiento en modo B selecciona la línea más cercana
    if (arrastre && arrastre.tipo === 'desplazar' && !arrastre.movido && !pellizco && r && app.modo() === 'B') {
      const T = app.transformacion();
      const q = aImagen(T, arrastre.p0);
      let sel = null, dsel = (26 * dpr()) / T.escala;
      const n = r.segmentos.length / 4;
      for (let i = 0; i < n; i++) {
        if (r.familiaSeg[i] < 0) continue;
        const d = distanciaSegmento(q, r.segmentos, i);
        if (d < dsel) { dsel = d; sel = i; }
      }
      app.seleccionar(sel);
    }
    dedos.delete(e.pointerId);
    if (dedos.size < 2) pellizco = null;
    if (dedos.size === 0) arrastre = null;
    else if (!pellizco) arrastre = null; // al soltar un dedo del pellizco no se arrastra nada
  };
  lienzo.addEventListener('pointerup', fin);
  lienzo.addEventListener('pointercancel', fin);

  // Ordenador: rueda del ratón o gesto de trackpad
  lienzo.addEventListener('wheel', (e) => {
    if (!app.resultado() || !app.editable()) return;
    e.preventDefault();
    const p = aLienzo(e);
    const T = app.transformacion();
    zoomEn(p, app.vista().zoom * Math.exp(-e.deltaY * 0.0015), aImagen(T, p));
  }, { passive: false });
}

function distanciaSegmento(p, s, i) {
  const x1 = s[i * 4], y1 = s[i * 4 + 1], x2 = s[i * 4 + 2], y2 = s[i * 4 + 3];
  const dx = x2 - x1, dy = y2 - y1;
  const L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / L2));
  return Math.hypot(p[0] - (x1 + t * dx), p[1] - (y1 + t * dy));
}
