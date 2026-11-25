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

// --- selección de líneas representativas ------------------------------------
/**
 * De todas las líneas de una familia, elige pocas (CONFIG.lineasPorFamilia):
 * las más largas, pero bien repartidas por la imagen (no cinco líneas casi
 * iguales en la misma ventana). Así el abanico de líneas de fuga se lee de un vistazo.
 */
export function representativas(r, k, n = CONFIG.lineasPorFamilia) {
  const P = r.familias[k].punto;
  const cx = r.ancho / 2, cy = r.alto / 2;
  const cand = [];
  const total = r.segmentos.length / 4;
  for (let i = 0; i < total; i++) {
    if (r.familiaSeg[i] !== k) continue;
    const x1 = r.segmentos[i * 4], y1 = r.segmentos[i * 4 + 1], x2 = r.segmentos[i * 4 + 2], y2 = r.segmentos[i * 4 + 3];
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    // recta que une el punto de fuga con el centro del segmento: su distancia al
    // centro de la imagen indica "dónde" está la línea dentro del abanico
    const l = [P[1] - my * P[2], mx * P[2] - P[0], P[0] * my - P[1] * mx];
    const d = (l[0] * cx + l[1] * cy + l[2]) / (Math.hypot(l[0], l[1]) || 1);
    cand.push({ i, L: Math.hypot(x2 - x1, y2 - y1), d });
  }
  if (!cand.length) return [];
  const ds = cand.map((c) => c.d);
  const separacion = Math.max((Math.max(...ds) - Math.min(...ds)) / (n * 1.3), 0.025 * r.ancho);
  cand.sort((a, b) => b.L - a.L);
  const elegidas = [];
  for (const c of cand) {
    if (elegidas.length >= n) break;
    if (elegidas.every((e) => Math.abs(e.d - c.d) >= separacion)) elegidas.push(c);
  }
  return elegidas.map((e) => e.i);
}

/** Punto donde un rayo (origen o, dirección u) sale del rectángulo m = [x0, y0, x1, y1]. */
function salidaRayo(o, u, m) {
  let t = Infinity;
  if (u[0] > 1e-9) t = Math.min(t, (m[2] - o[0]) / u[0]);
  if (u[0] < -1e-9) t = Math.min(t, (m[0] - o[0]) / u[0]);
  if (u[1] > 1e-9) t = Math.min(t, (m[3] - o[1]) / u[1]);
  if (u[1] < -1e-9) t = Math.min(t, (m[1] - o[1]) / u[1]);
  return t;
}

/** Línea con un halo oscuro debajo: se lee sobre paredes blancas y sobre fondos oscuros. */
function lineaConHalo(ctx, a, b, color, ancho, g, alfa = 1) {
  ctx.globalAlpha = alfa * 0.55;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = ancho + 2.5 * g;
  linea(ctx, a, b);
  ctx.globalAlpha = alfa;
  ctx.strokeStyle = color;
  ctx.lineWidth = ancho;
  linea(ctx, a, b);
  ctx.globalAlpha = 1;
}

/** Distancia (en anchos de imagen) del punto de fuga al centro; Infinity si está en el infinito. */
export function distanciaAnchos(r, P) {
  if (Math.abs(P[2]) < 1e-12) return Infinity;
  return Math.hypot(P[0] / P[2] - r.ancho / 2, P[1] / P[2] - r.alto / 2) / r.ancho;
}

// --- dibujo principal ----------------------------------------------------------
/**
 * Jerarquía visual (de lo más importante a lo menos):
 *   1. horizonte  2. puntos de fuga  3. unas pocas líneas de fuga por familia
 *   4. (opcional) todas las aristas detectadas  5. (opcional) rejilla
 * Las verticales solo se dibujan si convergen de forma visible.
 *
 * @param ctx  contexto 2D
 * @param r    resultado del análisis (o del seguimiento / edición manual)
 * @param T    transformación imagen → lienzo
 * @param op   { modo: 'A'|'B', rejilla, aristas, seleccion, g (grosor: 1 = 1 px CSS), horizonteSensor }
 */
export function dibujarSuperposicion(ctx, r, T, op = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const g = op.g || Math.max(1, Math.min(W, H) / 700);
  const limite = 1e6;
  etiquetarFamilias(r.familias);
  ctx.save();
  ctx.lineCap = 'round';

  // rectángulo de la imagen en el lienzo (las líneas no salen de él)
  const marco = [Math.max(0, T.ox), Math.max(0, T.oy), Math.min(W, T.ox + T.escala * (r.ancho || W)), Math.min(H, T.oy + T.escala * (r.alto || H))];
  const seg = (i) => [aLienzo(T, r.segmentos[i * 4], r.segmentos[i * 4 + 1]), aLienzo(T, r.segmentos[i * 4 + 2], r.segmentos[i * 4 + 3])];
  const nSeg = r.segmentos.length / 4;

  // 1. (Opcional) todas las aristas detectadas, finas
  if (op.aristas) {
    ctx.lineWidth = 1.5 * g;
    for (let i = 0; i < nSeg; i++) {
      const k = r.familiaSeg[i];
      ctx.strokeStyle = k < 0 ? COLORES.suelto : r.familias[k].color;
      ctx.globalAlpha = k < 0 ? 1 : 0.8;
      const [a, b] = seg(i);
      linea(ctx, a, b);
    }
    ctx.globalAlpha = 1;
  }

  // 2. (Opcional) rejilla de perspectiva
  if (op.rejilla) {
    for (const f of r.familias) dibujarRayos(ctx, T, f, W, H, g, limite);
  }

  // 3. Líneas de fuga: pocas, largas, desde el punto de fuga hasta el borde de la imagen
  r.familias.forEach((f, k) => {
    const dist = distanciaAnchos(r, f.punto);
    // verticales paralelas (cámara a plomo): no aportan nada y llenan la imagen de rayas
    if (f.tipo === 'vertical' && dist > CONFIG.distanciaConvergencia) return;
    const n = f.tipo === 'vertical' ? 3 : CONFIG.lineasPorFamilia;
    const vp = dist < CONFIG.distanciaInfinito ? cartesianoLienzo(T, f.punto, limite) : null;
    for (const i of representativas(r, k, n)) {
      const [a, b] = seg(i);
      if (vp) {
        const lejos = Math.hypot(a[0] - vp[0], a[1] - vp[1]) > Math.hypot(b[0] - vp[0], b[1] - vp[1]) ? a : b;
        const dl = Math.hypot(lejos[0] - vp[0], lejos[1] - vp[1]) || 1;
        const u = [(lejos[0] - vp[0]) / dl, (lejos[1] - vp[1]) / dl];
        // el rayo sale del punto de fuga y llega hasta el borde de la imagen
        let t = salidaRayo(vp, u, marco);
        if (!isFinite(t) || t < dl) t = dl;
        lineaConHalo(ctx, vp, [vp[0] + u[0] * t, vp[1] + u[1] * t], f.color, 2 * g, g);
      } else {
        // punto en el infinito: líneas paralelas, más discretas
        const l = [a[1] - b[1], b[0] - a[0], a[0] * b[1] - a[1] * b[0]];
        const p = recortarRecta(l, marco[2], marco[3], marco[0], marco[1]);
        if (p) lineaConHalo(ctx, p[0], p[1], f.color, 1.5 * g, g, 0.75);
      }
      // la arista real que sostiene la línea, resaltada
      lineaConHalo(ctx, a, b, f.color, 4 * g, g);
    }
  });

  // 4. Horizonte: uno solo si escena y sensor coinciden; los dos si discrepan
  const hs = op.horizonteSensor !== undefined ? op.horizonteSensor : r.horizonteSensor;
  const pEscena = r.horizonte ? recortarRecta(rectaLienzo(T, r.horizonte.linea), W, H) : null;
  const pSensor = hs ? recortarRecta(rectaLienzo(T, hs), W, H) : null;
  let coinciden = false;
  if (pEscena && pSensor) {
    const yEn = (l, x) => { const m = rectaLienzo(T, l); return Math.abs(m[1]) < 1e-12 ? Infinity : -(m[0] * x + m[2]) / m[1]; };
    coinciden = [marco[0], marco[2]].every((x) => Math.abs(yEn(r.horizonte.linea, x) - yEn(hs, x)) < 14 * g);
  }
  if (pSensor && !coinciden) {
    ctx.setLineDash([10 * g, 8 * g]);
    lineaConHalo(ctx, pSensor[0], pSensor[1], COLORES.sensor, 1.5 * g, g, 0.85);
    ctx.setLineDash([]);
    const izq = pSensor[0][0] < pSensor[1][0] ? pSensor[0] : pSensor[1];
    etiqueta(ctx, pEscena ? 'Horizonte según el sensor' : 'Horizonte (sensor)', izq[0] + 8 * g, izq[1] + 16 * g, COLORES.sensor, g);
  }
  if (pEscena) {
    lineaConHalo(ctx, pEscena[0], pEscena[1], COLORES.horizonte, 2.5 * g, g);
    const izq = pEscena[0][0] < pEscena[1][0] ? pEscena[0] : pEscena[1];
    const extra = r.horizonte.manual ? ' (ajustado a mano)' : coinciden ? ' ✓ sensor' : r.horizonte.fuente.startsWith('estimado') ? ' (estimado)' : '';
    etiqueta(ctx, `Horizonte${extra}`, izq[0] + 8 * g, izq[1] - 16 * g, COLORES.horizonte, g);
  }

  // 5. Puntos de fuga: marcador si se ven, flecha en el borde si no
  for (const f of r.familias) {
    if (f.tipo === 'vertical' && distanciaAnchos(r, f.punto) > CONFIG.distanciaConvergencia) { f._pantalla = null; f._flecha = null; continue; }
    dibujarPuntoFuga(ctx, r, T, f, W, H, g, limite);
  }

  // 6. Modo B: desviación de la línea seleccionada
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
