// =============================================================================
// segmentos.js — detector de segmentos rectos.
//
// Versión simplificada y comentada del algoritmo LSD ("Line Segment Detector",
// von Gioi, Jakubowicz, Morel y Randall, 2010). Pasos:
//   1. Suavizar la imagen en grises (quitar ruido del sensor).
//   2. Calcular en cada píxel el gradiente: cuánto cambia la luz y en qué
//      dirección. Una arista es una zona donde la luz cambia bruscamente.
//   3. Agrupar píxeles vecinos cuyo gradiente apunta en la misma dirección
//      ("regiones de soporte de línea").
//   4. Ajustar un rectángulo a cada región; si es largo, estrecho y denso,
//      es un segmento recto.
//   5. Fusionar trozos colineales de una misma arista.
//
// Entrada: imagen en grises (Float32Array, valores 0–255), ancho, alto.
// Salida: { segmentos: Float32Array [x1, y1, x2, y2] por segmento, n }.
// =============================================================================

import { GRADOS } from './geometria.js';

/** Desenfoque gaussiano separable. */
function desenfocar(gris, ancho, alto, sigma) {
  if (sigma <= 0) return gris;
  const radio = Math.max(1, Math.ceil(sigma * 2.5));
  const nucleo = [];
  let suma = 0;
  for (let i = -radio; i <= radio; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    nucleo.push(w);
    suma += w;
  }
  for (let i = 0; i < nucleo.length; i++) nucleo[i] /= suma;

  const tmp = new Float32Array(ancho * alto);
  const out = new Float32Array(ancho * alto);
  for (let y = 0; y < alto; y++) {
    const fila = y * ancho;
    for (let x = 0; x < ancho; x++) {
      let s = 0;
      for (let k = -radio; k <= radio; k++) {
        const xx = Math.min(ancho - 1, Math.max(0, x + k));
        s += gris[fila + xx] * nucleo[k + radio];
      }
      tmp[fila + x] = s;
    }
  }
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      let s = 0;
      for (let k = -radio; k <= radio; k++) {
        const yy = Math.min(alto - 1, Math.max(0, y + k));
        s += tmp[yy * ancho + x] * nucleo[k + radio];
      }
      out[y * ancho + x] = s;
    }
  }
  return out;
}

/** Diferencia angular entre a y b (radianes), en [0, π]. */
function difAngulo(a, b) {
  let d = Math.abs(a - b);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

export function detectarSegmentos(grisEntrada, ancho, alto, cfg) {
  const gris = desenfocar(grisEntrada, ancho, alto, cfg.desenfoqueSigma);
  const N = ancho * alto;
  const lado = Math.max(ancho, alto);

  // --- 2. Gradiente (máscara 2×2 de LSD) -------------------------------------
  // El "ángulo de línea" es perpendicular al gradiente: la dirección de la arista.
  const modulo = new Float32Array(N);
  const angulo = new Float32Array(N);
  const NO_DEF = -1000;
  let maxModulo = 0;
  for (let y = 0; y < alto - 1; y++) {
    for (let x = 0; x < ancho - 1; x++) {
      const i = y * ancho + x;
      const A = gris[i], B = gris[i + 1], C = gris[i + ancho], D = gris[i + ancho + 1];
      const gx = (B + D - A - C) / 2;
      const gy = (C + D - A - B) / 2;
      const m = Math.hypot(gx, gy);
      modulo[i] = m;
      if (m < cfg.umbralGradiente) {
        angulo[i] = NO_DEF;
      } else {
        angulo[i] = Math.atan2(gx, -gy);
        if (m > maxModulo) maxModulo = m;
      }
    }
  }
  for (let x = 0; x < ancho; x++) angulo[(alto - 1) * ancho + x] = NO_DEF;
  for (let y = 0; y < alto; y++) angulo[y * ancho + ancho - 1] = NO_DEF;

  // --- Orden de semillas: de mayor a menor gradiente (ordenación por cubetas) --
  const CUBETAS = 1024;
  const cuenta = new Int32Array(CUBETAS + 1);
  const cubeta = new Int32Array(N);
  let validos = 0;
  for (let i = 0; i < N; i++) {
    if (angulo[i] === NO_DEF) { cubeta[i] = -1; continue; }
    const b = Math.min(CUBETAS - 1, Math.floor((modulo[i] / maxModulo) * CUBETAS));
    cubeta[i] = b;
    cuenta[b]++;
    validos++;
  }
  const inicio = new Int32Array(CUBETAS);
  let acum = 0;
  for (let b = CUBETAS - 1; b >= 0; b--) { inicio[b] = acum; acum += cuenta[b]; }
  const orden = new Int32Array(validos);
  for (let i = 0; i < N; i++) if (cubeta[i] >= 0) orden[inicio[cubeta[i]]++] = i;

  // --- 3. Crecimiento de regiones ---------------------------------------------
  const usado = new Uint8Array(N);
  const tolerancia = cfg.toleranciaAngulo / GRADOS;
  const region = new Int32Array(N);
  const longitudMin = cfg.longitudMinimaRel * lado;
  const crudos = [];

  for (let s = 0; s < validos; s++) {
    const semilla = orden[s];
    if (usado[semilla]) continue;

    let tam = 0;
    region[tam++] = semilla;
    usado[semilla] = 1;
    let anguloRegion = angulo[semilla];
    let sumCos = Math.cos(anguloRegion), sumSin = Math.sin(anguloRegion);

    for (let k = 0; k < tam; k++) {
      const p = region[k];
      const px = p % ancho, py = (p - px) / ancho;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= alto) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = px + dx;
          if (xx < 0 || xx >= ancho) continue;
          const q = yy * ancho + xx;
          if (usado[q] || angulo[q] === NO_DEF) continue;
          if (difAngulo(angulo[q], anguloRegion) <= tolerancia) {
            usado[q] = 1;
            region[tam++] = q;
            sumCos += Math.cos(angulo[q]);
            sumSin += Math.sin(angulo[q]);
            anguloRegion = Math.atan2(sumSin, sumCos);
          }
        }
      }
    }
    if (tam < cfg.regionMinima) continue;

    // --- 4. Rectángulo ajustado (análisis de componentes principales) --------
    let sw = 0, cx = 0, cy = 0;
    for (let k = 0; k < tam; k++) {
      const p = region[k], w = modulo[p];
      const px = p % ancho, py = (p - px) / ancho;
      sw += w; cx += w * px; cy += w * py;
    }
    cx /= sw; cy /= sw;
    let sxx = 0, syy = 0, sxy = 0;
    for (let k = 0; k < tam; k++) {
      const p = region[k], w = modulo[p];
      const px = p % ancho, py = (p - px) / ancho;
      const ex = px - cx, ey = py - cy;
      sxx += w * ex * ex; syy += w * ey * ey; sxy += w * ex * ey;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const dx = Math.cos(theta), dy = Math.sin(theta);
    let tmin = Infinity, tmax = -Infinity, smin = Infinity, smax = -Infinity;
    for (let k = 0; k < tam; k++) {
      const p = region[k];
      const px = p % ancho, py = (p - px) / ancho;
      const t = (px - cx) * dx + (py - cy) * dy;
      const sp = -(px - cx) * dy + (py - cy) * dx;
      if (t < tmin) tmin = t; if (t > tmax) tmax = t;
      if (sp < smin) smin = sp; if (sp > smax) smax = sp;
    }
    const longitud = tmax - tmin + 1;
    const anchura = smax - smin + 1;
    const densidad = tam / (longitud * anchura);

    if (longitud < longitudMin) continue;
    if (anchura / longitud > cfg.anchoMaximoRel) continue;
    if (densidad < cfg.densidadMinima) continue;

    // El gradiente se mide en el centro de cada bloque 2×2 → desplazar 0,5 px
    crudos.push([
      cx + tmin * dx + 0.5, cy + tmin * dy + 0.5,
      cx + tmax * dx + 0.5, cy + tmax * dy + 0.5,
    ]);
  }

  // --- 5. Fusión de segmentos colineales --------------------------------------
  const fusionados = fusionarColineales(crudos, cfg, lado);
  const segmentos = new Float32Array(fusionados.length * 4);
  fusionados.forEach((s, i) => segmentos.set(s, i * 4));
  return { segmentos, n: fusionados.length };
}

function fusionarColineales(segs, cfg, lado) {
  const huecoMax = cfg.fusionHuecoRel * lado;
  const cosMax = Math.cos(cfg.fusionAngulo / GRADOS);
  let lista = segs.map((s) => s.slice());
  let cambio = true;
  while (cambio) {
    cambio = false;
    lista.sort((a, b) => Math.hypot(b[2] - b[0], b[3] - b[1]) - Math.hypot(a[2] - a[0], a[3] - a[1]));
    const vivos = new Array(lista.length).fill(true);
    for (let i = 0; i < lista.length; i++) {
      if (!vivos[i]) continue;
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i];
        if (!vivos[j]) continue;
        const b = lista[j];
        const la = Math.hypot(a[2] - a[0], a[3] - a[1]);
        const lb = Math.hypot(b[2] - b[0], b[3] - b[1]);
        const dx = (a[2] - a[0]) / la, dy = (a[3] - a[1]) / la;
        const ex = (b[2] - b[0]) / lb, ey = (b[3] - b[1]) / lb;
        if (Math.abs(dx * ex + dy * ey) < cosMax) continue;
        // distancia perpendicular de los extremos de b a la recta de a
        const d1 = Math.abs(-(b[0] - a[0]) * dy + (b[1] - a[1]) * dx);
        const d2 = Math.abs(-(b[2] - a[0]) * dy + (b[3] - a[1]) * dx);
        if (Math.max(d1, d2) > cfg.fusionDistancia) continue;
        // hueco a lo largo de la recta
        const t1 = (b[0] - a[0]) * dx + (b[1] - a[1]) * dy;
        const t2 = (b[2] - a[0]) * dx + (b[3] - a[1]) * dy;
        const bmin = Math.min(t1, t2), bmax = Math.max(t1, t2);
        const hueco = Math.max(0, bmin - la, -bmax);
        if (hueco > huecoMax) continue;
        const tmin = Math.min(0, bmin), tmax = Math.max(la, bmax);
        lista[i] = [a[0] + tmin * dx, a[1] + tmin * dy, a[0] + tmax * dx, a[1] + tmax * dy];
        vivos[j] = false;
        cambio = true;
      }
    }
    lista = lista.filter((_, k) => vivos[k]);
  }
  return lista;
}
