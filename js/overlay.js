// =============================================================================
// overlay.js — dibuja la superposición de perspectiva sobre la imagen.
//
// Todo lo que se dibuja está en píxeles de la imagen original y se transforma
// a píxeles del lienzo con T = { escala, ox, oy }:  X = ox + escala · x.
// La misma función sirve para la pantalla y para la imagen exportada.
// =============================================================================

import { COLORES, CONFIG } from './config.js';

/** Asigna color y etiqueta a cada familia (estables: izquierda → derecha). */
export function etiquetarFamilias(familias) {
  const hor = familias
    .map((f, i) => ({ f, i, x: Math.abs(f.punto[2]) > 1e-9 ? f.punto[0] / f.punto[2] : (f.punto[0] >= 0 ? 1e12 : -1e12) }))
    .filter((o) => o.f.tipo === 'horizontal')
    .sort((a, b) => a.x - b.x);
  hor.forEach((o, k) => {
    o.f.color = COLORES.horizontal[k % 2];
    o.f.etiqueta = `PF${k + 1}`;
  });
  for (const f of familias) {
    if (f.tipo === 'vertical') { f.color = COLORES.vertical; f.etiqueta = 'PF vertical'; }
    if (f.tipo === 'inclinada') { f.color = COLORES.inclinada; f.etiqueta = 'PF inclinado'; }
  }
}

// --- utilidades de transformación -------------------------------------------
function aLienzo(T, x, y) { return [T.ox + T.escala * x, T.oy + T.escala * y]; }
function puntoLienzo(T, P) { return [T.escala * P[0] + T.ox * P[2], T.escala * P[1] + T.oy * P[2], P[2]]; }
function rectaLienzo(T, l) { return [l[0], l[1], l[2] * T.escala - l[0] * T.ox - l[1] * T.oy]; }

/** Recorta la recta a·x + b·y + c = 0 al rectángulo [x0, W] × [y0, H]. */
export function recortarRecta(l, W, H, x0 = 0, y0 = 0) {
  const [a, b, c] = l;
  const pts = [];
  if (Math.abs(b) > 1e-12) {
    for (const x of [x0, W]) { const y = -(a * x + c) / b; if (y >= y0 - 1 && y <= H + 1) pts.push([x, y]); }
  }
  if (Math.abs(a) > 1e-12) {
    for (const y of [y0, H]) { const x = -(b * y + c) / a; if (x >= x0 - 1 && x <= W + 1) pts.push([x, y]); }
  }
  if (pts.length < 2) return null;
  let mejor = null, dmax = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    if (d > dmax) { dmax = d; mejor = [pts[i], pts[j]]; }
  }
  return mejor;
}

/** Posición cartesiana de un punto de fuga en el lienzo, o null si es (casi) infinito. */
function cartesianoLienzo(T, P, limite) {
  const Q = puntoLienzo(T, P);
  if (Math.abs(Q[2]) < 1e-12) return null;
  const x = Q[0] / Q[2], y = Q[1] / Q[2];
  if (Math.abs(x) > limite || Math.abs(y) > limite) return null;
  return [x, y];
}

function linea(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }

function etiqueta(ctx, texto, x, y, color, g, alinear = 'left') {
  ctx.font = `600 ${Math.round(13 * g)}px system-ui, sans-serif`;
  const w = ctx.measureText(texto).width, h = 18 * g, pad = 5 * g;
  let bx = alinear === 'center' ? x - w / 2 - pad : alinear === 'right' ? x - w - 2 * pad : x;
  bx = Math.max(2, Math.min(ctx.canvas.width - w - 2 * pad - 2, bx));
  const by = Math.max(2, Math.min(ctx.canvas.height - h - 2, y - h / 2));
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, w + 2 * pad, h, 4 * g); else ctx.rect(bx, by, w + 2 * pad, h);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, bx + pad, by + h / 2 + 0.5);
}

/** Distancia del punto de fuga al centro de la imagen, en anchos de imagen. */
function textoDistancia(r, P) {
  if (Math.abs(P[2]) < 1e-12) return '∞';
  const d = Math.hypot(P[0] / P[2] - r.ancho / 2, P[1] / P[2] - r.alto / 2) / r.ancho;
  return d > CONFIG.distanciaInfinito ? '∞' : `${d.toFixed(1).replace('.', ',')} anchos`;
}

// --- dibujo principal ----------------------------------------------------------
/**
 * @param ctx  contexto 2D
 * @param r    resultado del análisis (o del seguimiento / edición manual)
 * @param T    transformación imagen → lienzo
 * @param op   { modo: 'A'|'B', rejilla, sueltos, seleccion, g (grosor: 1 = 1 px CSS), horizonteSensor }
 */
export function dibujarSuperposicion(ctx, r, T, op = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const g = op.g || Math.max(1, Math.min(W, H) / 700);
  const limite = 1e6;
  etiquetarFamilias(r.familias);
  ctx.save();
  ctx.lineCap = 'round';

  // rectángulo de la imagen en el lienzo (las rectas paralelas no salen de él)
  const marco = [Math.max(0, T.ox), Math.max(0, T.oy), Math.min(W, T.ox + T.escala * (r.ancho || W)), Math.min(H, T.oy + T.escala * (r.alto || H))];
  const seg = (i) => [aLienzo(T, r.segmentos[i * 4], r.segmentos[i * 4 + 1]), aLienzo(T, r.segmentos[i * 4 + 2], r.segmentos[i * 4 + 3])];
  const nSeg = r.segmentos.length / 4;

  // 1. Segmentos que no pertenecen a ninguna familia
  if (op.sueltos) {
    ctx.strokeStyle = COLORES.suelto;
    ctx.lineWidth = 1.5 * g;
    for (let i = 0; i < nSeg; i++) if (r.familiaSeg[i] < 0) { const [a, b] = seg(i); linea(ctx, a, b); }
  }

  // 2. Rejilla de perspectiva (rayos desde cada punto de fuga)
  if (op.rejilla) {
    for (const f of r.familias) dibujarRayos(ctx, T, f, W, H, g, limite);
  }

  // 3. Prolongación de las líneas más largas hasta su punto de fuga
  r.familias.forEach((f, k) => {
    const indices = [];
    for (let i = 0; i < nSeg; i++) if (r.familiaSeg[i] === k) indices.push(i);
    indices.sort((a, b) => longitud(r, b) - longitud(r, a));
    const vp = cartesianoLienzo(T, f.punto, limite);
    ctx.strokeStyle = f.color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1 * g;
    ctx.setLineDash([6 * g, 5 * g]);
    for (const i of indices.slice(0, CONFIG.prolongacionesPorFamilia)) {
      const [a, b] = seg(i);
      if (vp) {
        const lejos = Math.hypot(a[0] - vp[0], a[1] - vp[1]) > Math.hypot(b[0] - vp[0], b[1] - vp[1]) ? a : b;
        linea(ctx, lejos, vp);
      } else {
        const l = [a[1] - b[1], b[0] - a[0], a[0] * b[1] - a[1] * b[0]];
        const p = recortarRecta(l, marco[2], marco[3], marco[0], marco[1]);
        if (p) linea(ctx, p[0], p[1]);
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  });

  // 4. Segmentos de cada familia
  ctx.lineWidth = 3 * g;
  for (let i = 0; i < nSeg; i++) {
    const k = r.familiaSeg[i];
    if (k < 0) continue;
    ctx.strokeStyle = r.familias[k].color;
    const [a, b] = seg(i);
    linea(ctx, a, b);
  }

  // 5. Horizonte del sensor (discontinuo) y de la escena (continuo)
  const hs = op.horizonteSensor !== undefined ? op.horizonteSensor : r.horizonteSensor;
  if (hs) {
    const p = recortarRecta(rectaLienzo(T, hs), W, H);
    if (p) {
      ctx.strokeStyle = COLORES.sensor; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.5 * g;
      ctx.setLineDash([10 * g, 8 * g]); linea(ctx, p[0], p[1]); ctx.setLineDash([]); ctx.globalAlpha = 1;
      const izq = p[0][0] < p[1][0] ? p[0] : p[1];
      etiqueta(ctx, 'Horizonte según el sensor', izq[0] + 8 * g, izq[1] + 16 * g, COLORES.sensor, g);
    }
  }
  if (r.horizonte) {
    const p = recortarRecta(rectaLienzo(T, r.horizonte.linea), W, H);
    if (p) {
      ctx.strokeStyle = COLORES.horizonte; ctx.lineWidth = 2.5 * g;
      linea(ctx, p[0], p[1]);
      const izq = p[0][0] < p[1][0] ? p[0] : p[1];
      const extra = r.horizonte.manual ? ' (ajustado a mano)' : r.horizonte.fuente.startsWith('estimado') ? ' (estimado)' : '';
      etiqueta(ctx, `Horizonte${extra}`, izq[0] + 8 * g, izq[1] - 16 * g, COLORES.horizonte, g);
    }
  }

  // 6. Puntos de fuga: marcador si se ven, flecha en el borde si no
  for (const f of r.familias) dibujarPuntoFuga(ctx, r, T, f, W, H, g, limite);

  // 7. Modo B: desviación de la línea seleccionada
  if (op.modo === 'B' && op.seleccion != null && op.seleccion < nSeg && r.familiaSeg[op.seleccion] >= 0) {
    const i = op.seleccion, f = r.familias[r.familiaSeg[i]];
    const [a, b] = seg(i);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 7 * g; linea(ctx, a, b);
    ctx.strokeStyle = f.color; ctx.lineWidth = 4 * g; linea(ctx, a, b);
    const texto = `Desviación ${r.residualSeg[i].toFixed(1).replace('.', ',')}° respecto a ${f.etiqueta}`;
    etiqueta(ctx, texto, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 22 * g, '#fff', g, 'center');
  }
  ctx.restore();
}

function longitud(r, i) {
  return Math.hypot(r.segmentos[i * 4 + 2] - r.segmentos[i * 4], r.segmentos[i * 4 + 3] - r.segmentos[i * 4 + 1]);
}

function dibujarPuntoFuga(ctx, r, T, f, W, H, g, limite) {
  const m = 26 * g;
  f._pantalla = null;
  f._flecha = null;
  const vp = cartesianoLienzo(T, f.punto, limite);
  const lejano = textoDistancia(r, f.punto) === '∞';
  if (vp && !lejano && vp[0] > m && vp[0] < W - m && vp[1] > m && vp[1] < H - m) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.arc(vp[0], vp[1], 11 * g, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = f.color; ctx.lineWidth = 3 * g;
    ctx.beginPath(); ctx.arc(vp[0], vp[1], 9 * g, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = f.color;
    ctx.beginPath(); ctx.arc(vp[0], vp[1], 2.5 * g, 0, Math.PI * 2); ctx.fill();
    etiqueta(ctx, f.etiqueta + (f.manual ? ' ✋' : ''), vp[0] + 16 * g, vp[1] - 14 * g, f.color, g);
    f._pantalla = vp;
    return;
  }
  // Fuera de la pantalla: flecha en el borde, en la dirección del punto
  const C = [W / 2, H / 2];
  const P = puntoLienzo(T, f.punto);
  let dirs;
  if (vp && !lejano) dirs = [[vp[0] - C[0], vp[1] - C[1]]];
  else {
    // en el infinito (rectas paralelas): el "punto" está en ambos sentidos
    const d = Math.abs(P[2]) < 1e-12 || !vp ? [P[0], P[1]] : [vp[0] - C[0], vp[1] - C[1]];
    dirs = [d, [-d[0], -d[1]]];
  }
  const texto = `${f.etiqueta} → ${textoDistancia(r, f.punto)}`;
  f._pantalla = null;
  dirs.forEach((d, k) => {
    const n = Math.hypot(d[0], d[1]) || 1;
    const ux = d[0] / n, uy = d[1] / n;
    const tx = ux > 0 ? (W - m - C[0]) / ux : ux < 0 ? (m - C[0]) / ux : Infinity;
    const ty = uy > 0 ? (H - m - C[1]) / uy : uy < 0 ? (m - C[1]) / uy : Infinity;
    const t = Math.min(tx, ty);
    const x = C[0] + ux * t, y = C[1] + uy * t;
    const s = 14 * g;
    ctx.fillStyle = f.color; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2 * g;
    ctx.beginPath();
    ctx.moveTo(x + ux * s, y + uy * s);
    ctx.lineTo(x - ux * s * 0.6 - uy * s * 0.7, y - uy * s * 0.6 + ux * s * 0.7);
    ctx.lineTo(x - ux * s * 0.6 + uy * s * 0.7, y - uy * s * 0.6 - ux * s * 0.7);
    ctx.closePath(); ctx.stroke(); ctx.fill();
    if (k === 0) {
      etiqueta(ctx, texto, x - ux * 30 * g, y - uy * 30 * g, f.color, g, ux > 0.3 ? 'right' : ux < -0.3 ? 'left' : 'center');
      f._flecha = [x, y];
    }
  });
}

function dibujarRayos(ctx, T, f, W, H, g, limite) {
  const n = CONFIG.rayosRejilla;
  const vp = cartesianoLienzo(T, f.punto, limite);
  ctx.strokeStyle = f.color;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1 * g;
  const esquinas = [[0, 0], [W, 0], [W, H], [0, H]];
  if (!vp) {
    const P = puntoLienzo(T, f.punto);
    const d = [P[0], P[1]], nn = Math.hypot(d[0], d[1]) || 1;
    const nx = -d[1] / nn, ny = d[0] / nn;
    const proy = esquinas.map((c) => c[0] * nx + c[1] * ny);
    const a = Math.min(...proy), b = Math.max(...proy);
    for (let k = 1; k < n; k++) {
      const s = a + ((b - a) * k) / n;
      const p = recortarRecta([nx, ny, -s], W, H);
      if (p) linea(ctx, p[0], p[1]);
    }
  } else {
    const dentro = vp[0] >= 0 && vp[0] <= W && vp[1] >= 0 && vp[1] <= H;
    const base = Math.atan2(H / 2 - vp[1], W / 2 - vp[0]);
    let a0 = -Math.PI, a1 = Math.PI, pasos = 2 * n;
    if (!dentro) {
      const rel = esquinas.map((c) => {
        let d = Math.atan2(c[1] - vp[1], c[0] - vp[0]) - base;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return d;
      });
      a0 = Math.min(...rel); a1 = Math.max(...rel); pasos = n;
    }
    const R = 4 * Math.hypot(W, H) + Math.hypot(vp[0] - W / 2, vp[1] - H / 2);
    for (let k = dentro ? 0 : 1; k < pasos; k++) {
      const ang = base + a0 + ((a1 - a0) * k) / pasos;
      linea(ctx, vp, [vp[0] + R * Math.cos(ang), vp[1] + R * Math.sin(ang)]);
    }
  }
  ctx.globalAlpha = 1;
}
