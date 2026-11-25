// =============================================================================
// geometria.js — herramientas de geometría proyectiva.
//
// Idea clave para explicar en clase: en coordenadas homogéneas, un punto de
// la imagen es un vector de 3 números (x, y, w). Si w = 0 el punto está "en el
// infinito": así se representan los puntos de fuga de rectas paralelas en la
// imagen. Recta que pasa por dos puntos = producto vectorial de los puntos;
// punto donde se cortan dos rectas = producto vectorial de las rectas.
//
// "Esfera": si centramos la imagen en su punto principal y dividimos por la
// focal f, cada punto de la imagen (x, y) se convierte en la DIRECCIÓN 3D
// ((x-cx)/f, (y-cy)/f, 1) que ve la cámara. Un punto de fuga es entonces la
// dirección 3D de una familia de rectas paralelas del espacio.
// =============================================================================

export const GRADOS = 180 / Math.PI;

export function cruz(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function punto3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalizar(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Ángulo (grados) entre dos DIRECCIONES sin sentido (v y -v son la misma). */
export function anguloDirecciones(a, b) {
  const c = Math.abs(punto3(normalizar(a), normalizar(b)));
  return Math.acos(Math.min(1, c)) * GRADOS;
}

/** Píxel (x, y) → dirección en la esfera de la cámara. cam = {f, cx, cy}. */
export function aEsfera(x, y, cam) {
  return [(x - cam.cx) / cam.f, (y - cam.cy) / cam.f, 1];
}

/** Dirección en la esfera → punto homogéneo de la imagen [X, Y, W]. */
export function aImagen(v, cam) {
  return [cam.f * v[0] + cam.cx * v[2], cam.f * v[1] + cam.cy * v[2], v[2]];
}

/**
 * Recta de la imagen [a, b, c] (a·x + b·y + c = 0) a partir de la normal N de un
 * plano que pasa por la cámara (por ejemplo, el horizonte: plano ⟂ a la vertical).
 */
export function rectaDesdeNormal(N, cam) {
  const a = N[0] / cam.f;
  const b = N[1] / cam.f;
  const c = N[2] - (N[0] * cam.cx + N[1] * cam.cy) / cam.f;
  return [a, b, c];
}

/**
 * Error angular (grados) entre un segmento y un punto de fuga.
 * Es el ángulo entre la dirección del segmento y la recta que va de su punto
 * medio al punto de fuga. Funciona también con puntos en el infinito (W ≈ 0).
 *   mx, my: punto medio; dx, dy: dirección unitaria; V: punto homogéneo.
 */
export function errorAngular(mx, my, dx, dy, V) {
  const ux = V[0] - mx * V[2];
  const uy = V[1] - my * V[2];
  const n = Math.hypot(ux, uy);
  if (n < 1e-12) return 90;
  const c = Math.abs(dx * ux + dy * uy) / n;
  return Math.acos(Math.min(1, c)) * GRADOS;
}

/** Punto homogéneo → cartesiano, o null si está (prácticamente) en el infinito. */
export function aCartesiano(V, escalaInfinito = 1e7) {
  if (Math.abs(V[2]) < 1e-12) return null;
  const x = V[0] / V[2], y = V[1] / V[2];
  if (Math.abs(x) > escalaInfinito || Math.abs(y) > escalaInfinito) return null;
  return [x, y];
}

/**
 * Autovector asociado al MENOR autovalor de una matriz simétrica 3×3
 * (método de Jacobi). Se usa para el ajuste por mínimos cuadrados del punto
 * de fuga: la dirección "más perpendicular" a todas las normales de las rectas.
 */
export function autovectorMenor(M) {
  const a = [M[0].slice(), M[1].slice(), M[2].slice()];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let barrido = 0; barrido < 50; barrido++) {
    const fuera = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (fuera < 1e-15) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let m = 0;
  if (a[1][1] < a[m][m]) m = 1;
  if (a[2][2] < a[m][m]) m = 2;
  return normalizar([v[0][m], v[1][m], v[2][m]]);
}

/** Generador pseudoaleatorio con semilla (mulberry32): mismos datos → mismo resultado. */
export function aleatorio(semilla) {
  let s = semilla >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Focal: milímetros equivalentes (35 mm) ↔ píxeles --------------------------
// La diagonal de un negativo de 35 mm mide 43,27 mm.
const DIAGONAL_35 = 43.267;
export function mmAPx(mm, ancho, alto) { return (mm / DIAGONAL_35) * Math.hypot(ancho, alto); }
export function pxAMm(px, ancho, alto) { return (px / Math.hypot(ancho, alto)) * DIAGONAL_35; }
