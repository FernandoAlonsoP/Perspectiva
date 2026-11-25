// =============================================================================
// escenas.js — generador de escenas sintéticas con geometría CONOCIDA.
//
// Dibujamos cajas, pasillos y fachadas con una cámara virtual (focal y giro
// conocidos), así sabemos exactamente dónde están los puntos de fuga y el
// horizonte, y podemos medir el error del algoritmo en grados.
//
// Mundo: x derecha, y arriba, z adelante. Cámara: x derecha, y abajo, z adelante.
// =============================================================================

const RAD = Math.PI / 180;

function rotacion(guinadaG, cabeceoG, alabeoG) {
  // guiñada (yaw) alrededor de la vertical, cabeceo (pitch) alrededor de x, alabeo (roll) alrededor de z
  const cy = Math.cos(guinadaG * RAD), sy = Math.sin(guinadaG * RAD);
  const cp = Math.cos(cabeceoG * RAD), sp = Math.sin(cabeceoG * RAD);
  const cr = Math.cos(alabeoG * RAD), sr = Math.sin(alabeoG * RAD);
  const Ry = [[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]];
  const Rx = [[1, 0, 0], [0, cp, -sp], [0, sp, cp]];
  const Rz = [[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]];
  const mul = (A, B) => A.map((f) => [0, 1, 2].map((j) => f[0] * B[0][j] + f[1] * B[1][j] + f[2] * B[2][j]));
  return mul(Rz, mul(Rx, Ry));
}

function crearCamara({ ancho, alto, focalPx, posicion, guinada = 0, cabeceo = 0, alabeo = 0 }) {
  const R = rotacion(guinada, cabeceo, alabeo);
  const aplicar = (v) => R.map((f) => f[0] * v[0] + f[1] * v[1] + f[2] * v[2]);
  // mundo → cámara (y del mundo hacia arriba → y de cámara hacia abajo)
  const aCamara = (P) => aplicar([P[0] - posicion[0], -(P[1] - posicion[1]), P[2] - posicion[2]]);
  const direccion = (d) => aplicar([d[0], -d[1], d[2]]);
  return {
    ancho, alto, f: focalPx, cx: ancho / 2, cy: alto / 2, aCamara, direccion,
    proyectar(Pc) { return [focalPx * Pc[0] / Pc[2] + ancho / 2, focalPx * Pc[1] / Pc[2] + alto / 2]; },
  };
}

// Recorta un polígono (coordenadas de cámara) contra el plano z = cerca
function recortarCerca(poly, cerca = 0.05) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ain = a[2] > cerca, bin = b[2] > cerca;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (cerca - a[2]) / (b[2] - a[2]);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), cerca]);
    }
  }
  return out;
}

/** Escena = lista de polígonos 3D con color y borde. */
function caja(x0, y0, z0, x1, y1, z1, color) {
  const v = (x, y, z) => [x, y, z];
  return [
    { p: [v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0)], c: color, k: 0.85 }, // frente
    { p: [v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)], c: color, k: 0.6 },
    { p: [v(x0, y0, z0), v(x0, y0, z1), v(x0, y1, z1), v(x0, y1, z0)], c: color, k: 0.7 },
    { p: [v(x1, y0, z0), v(x1, y0, z1), v(x1, y1, z1), v(x1, y1, z0)], c: color, k: 0.55 },
    { p: [v(x0, y1, z0), v(x1, y1, z0), v(x1, y1, z1), v(x0, y1, z1)], c: color, k: 1.0 },
  ];
}

/** Ventanas en un plano z = cte (fachada frontal) */
function ventanasZ(x0, x1, y0, y1, z, filas, cols, color) {
  const out = [];
  const w = (x1 - x0) / cols, h = (y1 - y0) / filas;
  for (let i = 0; i < filas; i++) for (let j = 0; j < cols; j++) {
    const a = x0 + j * w + w * 0.25, b = x0 + (j + 1) * w - w * 0.25;
    const c = y0 + i * h + h * 0.2, d = y0 + (i + 1) * h - h * 0.25;
    out.push({ p: [[a, c, z], [b, c, z], [b, d, z], [a, d, z]], c: color, k: 1, capa: 1 });
  }
  return out;
}
/** Ventanas en un plano x = cte (fachada lateral) */
function ventanasX(z0, z1, y0, y1, x, filas, cols, color) {
  const out = [];
  const w = (z1 - z0) / cols, h = (y1 - y0) / filas;
  for (let i = 0; i < filas; i++) for (let j = 0; j < cols; j++) {
    const a = z0 + j * w + w * 0.25, b = z0 + (j + 1) * w - w * 0.25;
    const c = y0 + i * h + h * 0.2, d = y0 + (i + 1) * h - h * 0.25;
    out.push({ p: [[x, c, a], [x, c, b], [x, d, b], [x, d, a]], c: color, k: 1, capa: 1 });
  }
  return out;
}

function suelo(x0, x1, z0, z1, paso, color) {
  const out = [];
  for (let x = x0; x < x1; x += paso) for (let z = z0; z < z1; z += paso) {
    const tono = ((Math.round(x / paso) + Math.round(z / paso)) % 2) ? 0.9 : 0.75;
    out.push({ p: [[x, 0, z], [x + paso, 0, z], [x + paso, 0, z + paso], [x, 0, z + paso]], c: color, k: tono, sinBorde: true });
  }
  return out;
}

function rgb(c, k) {
  return `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`;
}

function dibujar(ctx, cam, polys, ruido, semilla) {
  const g = ctx.createLinearGradient(0, 0, 0, cam.alto);
  g.addColorStop(0, '#9fc3e6'); g.addColorStop(1, '#dfe9f2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cam.ancho, cam.alto);

  const proy = [];
  for (const poly of polys) {
    const pc = recortarCerca(poly.p.map(cam.aCamara));
    if (pc.length < 3) continue;
    const prof = pc.reduce((t, p) => t + Math.hypot(p[0], p[1], p[2]), 0) / pc.length - (poly.capa || 0) * 0.01;
    proy.push({ pts: pc.map((p) => cam.proyectar(p)), prof, poly });
  }
  proy.sort((a, b) => b.prof - a.prof);
  for (const { pts, poly } of proy) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = rgb(poly.c, poly.k);
    ctx.fill();
    if (!poly.sinBorde) { ctx.strokeStyle = 'rgba(30,30,30,0.8)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  if (ruido) {
    let s = semilla >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const img = ctx.getImageData(0, 0, cam.ancho, cam.alto);
    for (let i = 0; i < img.data.length; i += 4) {
      const r = (rnd() + rnd() + rnd() - 1.5) * ruido;
      img.data[i] += r; img.data[i + 1] += r; img.data[i + 2] += r;
    }
    ctx.putImageData(img, 0, 0);
  }
}

/** Escena sin arquitectura: manchas y curvas. El algoritmo debe NO encontrar nada. */
function dibujarOrganica(ctx, ancho, alto, semilla) {
  let s = semilla >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  ctx.fillStyle = '#6d8f5a'; ctx.fillRect(0, 0, ancho, alto);
  for (let i = 0; i < 140; i++) {
    ctx.beginPath();
    ctx.ellipse(rnd() * ancho, rnd() * alto, 10 + rnd() * 90, 10 + rnd() * 70, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${80 + rnd() * 60},${30 + rnd() * 40}%,${20 + rnd() * 50}%)`;
    ctx.fill();
  }
  ctx.lineWidth = 3;
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.moveTo(rnd() * ancho, rnd() * alto);
    ctx.bezierCurveTo(rnd() * ancho, rnd() * alto, rnd() * ancho, rnd() * alto, rnd() * ancho, rnd() * alto);
    ctx.strokeStyle = `hsl(${30 + rnd() * 40},40%,${15 + rnd() * 30}%)`;
    ctx.stroke();
  }
  const img = ctx.getImageData(0, 0, ancho, alto);
  for (let i = 0; i < img.data.length; i += 4) {
    const r = (rnd() - 0.5) * 30;
    img.data[i] += r; img.data[i + 1] += r; img.data[i + 2] += r;
  }
  ctx.putImageData(img, 0, 0);
}

const GRIS = [205, 200, 190], LADRILLO = [180, 110, 80], AZUL = [60, 80, 110], BLANCO = [235, 235, 230], SUELO = [150, 150, 145];

// focal de 26 mm equivalentes en 1280×960 → 0,6009 × diagonal(1600) ≈ 961 px
const F26 = (26 / 43.267) * 1600;

export const ESCENAS = [
  {
    nombre: 'cubo-1pf',
    descripcion: 'Cajas frontales: perspectiva de 1 punto',
    camara: { posicion: [0, 1.6, -6], guinada: 0, cabeceo: 0 },
    polys: () => [...suelo(-8, 8, -2, 20, 1, SUELO), ...caja(-3, 0, 2, -1, 2, 5, LADRILLO), ...caja(0.5, 0, 4, 3, 3, 8, GRIS), ...caja(-1, 0, 10, 1.5, 1.5, 12, BLANCO)],
    ruido: 8,
  },
  {
    nombre: 'cubo-2pf',
    descripcion: 'Cajas giradas 35°: perspectiva de 2 puntos',
    camara: { posicion: [0, 1.6, -6], guinada: 35, cabeceo: 0 },
    polys: () => [...suelo(-10, 10, -4, 20, 1, SUELO), ...caja(-2, 0, 1, 1, 2.5, 4, LADRILLO), ...caja(2, 0, 3, 5, 4, 7, GRIS), ...caja(-6, 0, 4, -3, 1.5, 6, BLANCO)],
    ruido: 8,
  },
  {
    nombre: 'pasillo',
    descripcion: 'Pasillo interior visto en eje (1 punto, ligero giro)',
    camara: { posicion: [0, 1.6, 0], guinada: 4, cabeceo: 0 },
    polys: () => {
      const out = [];
      for (let z = 1; z < 30; z += 1.5) {
        const k = (Math.floor(z) % 2) ? 0.95 : 0.8;
        out.push({ p: [[-2, 0, z], [2, 0, z], [2, 0, z + 1.5], [-2, 0, z + 1.5]], c: SUELO, k });
        out.push({ p: [[-2, 3, z], [2, 3, z], [2, 3, z + 1.5], [-2, 3, z + 1.5]], c: BLANCO, k: k * 0.95 });
        out.push({ p: [[-2, 0, z], [-2, 3, z], [-2, 3, z + 1.5], [-2, 0, z + 1.5]], c: BLANCO, k: 0.85 });
        out.push({ p: [[2, 0, z], [2, 3, z], [2, 3, z + 1.5], [2, 0, z + 1.5]], c: BLANCO, k: 0.75 });
      }
      for (const z of [5, 11, 17]) {
        out.push({ p: [[-1.99, 0, z], [-1.99, 2.1, z], [-1.99, 2.1, z + 0.9], [-1.99, 0, z + 0.9]], c: AZUL, k: 1, capa: 1 });
        out.push({ p: [[1.99, 0, z + 2], [1.99, 2.1, z + 2], [1.99, 2.1, z + 2.9], [1.99, 0, z + 2.9]], c: AZUL, k: 1, capa: 1 });
      }
      out.push({ p: [[-2, 0, 30], [2, 0, 30], [2, 3, 30], [-2, 3, 30]], c: GRIS, k: 0.6 });
      return out;
    },
    ruido: 6,
  },
  {
    nombre: 'calle',
    descripcion: 'Calle con edificios a ambos lados, cámara girada 15°',
    camara: { posicion: [0, 1.6, 0], guinada: 15, cabeceo: -2 },
    polys: () => {
      const out = [...suelo(-12, 12, 0, 60, 2, SUELO)];
      for (let z = 4; z < 60; z += 9) {
        const h = 9 + ((z * 7) % 6);
        out.push(...caja(-14, 0, z, -6, h, z + 8, (z % 2) ? LADRILLO : GRIS));
        out.push(...ventanasX(z, z + 8, 1, h - 1, -5.99, Math.floor(h / 3), 3, AZUL));
        out.push(...caja(6, 0, z + 3, 14, h + 2, z + 11, (z % 2) ? GRIS : LADRILLO));
        out.push(...ventanasX(z + 3, z + 11, 1, h + 1, 5.99, Math.floor((h + 2) / 3), 3, AZUL));
      }
      return out;
    },
    ruido: 8,
  },
  {
    nombre: 'fachada',
    descripcion: 'Fachada vista desde abajo: verticales convergentes',
    camara: { posicion: [-3, 1.6, -2], guinada: 25, cabeceo: -18 },
    polys: () => [
      ...caja(-2, 0, 8, 14, 22, 16, LADRILLO),
      ...ventanasZ(-2, 14, 1, 21, 7.99, 7, 6, AZUL),
      ...ventanasX(8, 16, 1, 21, -2.01, 7, 3, AZUL),
    ],
    ruido: 8,
  },
  {
    nombre: 'cubo-2pf-16mm',
    descripcion: 'Las mismas cajas en 2 puntos con gran angular (16 mm): la focal debe estimarse',
    focalMM: 16,
    camara: { posicion: [0, 1.6, -6], guinada: 35, cabeceo: 0 },
    polys: () => [...suelo(-10, 10, -4, 20, 1, SUELO), ...caja(-2, 0, 1, 1, 2.5, 4, LADRILLO), ...caja(2, 0, 3, 5, 4, 7, GRIS), ...caja(-6, 0, 4, -3, 1.5, 6, BLANCO)],
    ruido: 8,
  },
  {
    nombre: 'calle-50mm',
    descripcion: 'Calle con teleobjetivo (50 mm): la focal debe estimarse, no suponerse',
    focalMM: 50,
    camara: { posicion: [-2, 1.6, -10], guinada: 30, cabeceo: 0 },
    polys: () => {
      const out = [...suelo(-16, 16, 0, 60, 2, SUELO)];
      for (let z = 4; z < 50; z += 10) {
        out.push(...caja(4, 0, z, 12, 10, z + 9, (z % 20) ? LADRILLO : GRIS));
        out.push(...ventanasZ(4, 12, 1, 9, z - 0.01, 3, 4, AZUL));
        out.push(...ventanasX(z, z + 9, 1, 9, 3.99, 3, 4, AZUL));
      }
      return out;
    },
    ruido: 10,
  },
  {
    nombre: 'edificio-arboles',
    descripcion: 'Edificio en 2 puntos con vegetación delante (40 % de la imagen)',
    camara: { posicion: [0, 1.6, -8], guinada: -30, cabeceo: 0 },
    polys: () => [...suelo(-10, 10, -4, 20, 1.5, SUELO), ...caja(-4, 0, 2, 4, 7, 9, GRIS), ...ventanasZ(-4, 4, 0.5, 6.5, 1.99, 4, 5, AZUL), ...ventanasX(2, 9, 0.5, 6.5, -4.01, 4, 4, AZUL)],
    ruido: 8,
    vegetacion: 0.4,
  },
  {
    nombre: 'salon',
    descripcion: 'Interior casi frontal, paredes blancas de poco contraste y pocas líneas en profundidad (como las primeras pruebas reales)',
    camara: { posicion: [0.6, 1.4, 0.4], guinada: -8, cabeceo: 0 },
    polys: () => {
      const PARED = [236, 234, 228], TECHO = [244, 243, 240], MADERA = [140, 90, 60];
      return [
        { p: [[-4, 0, 0], [4, 0, 0], [4, 0, 9], [-4, 0, 9]], c: MADERA, k: 0.85 },            // suelo
        { p: [[-4, 2.7, 0], [4, 2.7, 0], [4, 2.7, 9], [-4, 2.7, 9]], c: TECHO, k: 0.93 },     // techo
        { p: [[-4, 0, 0], [-4, 2.7, 0], [-4, 2.7, 9], [-4, 0, 9]], c: PARED, k: 0.88 },       // pared izquierda
        { p: [[4, 0, 0], [4, 2.7, 0], [4, 2.7, 9], [4, 0, 9]], c: PARED, k: 0.86 },            // pared derecha
        { p: [[-4, 0, 9], [4, 0, 9], [4, 2.7, 9], [-4, 2.7, 9]], c: PARED, k: 0.93 },         // fondo
        { p: [[-2.5, 0.9, 8.99], [0.5, 0.9, 8.99], [0.5, 2.3, 8.99], [-2.5, 2.3, 8.99]], c: [40, 45, 55], k: 1, capa: 1 }, // ventana
        { p: [[1.5, 0, 8.99], [2.4, 0, 8.99], [2.4, 2.1, 8.99], [1.5, 2.1, 8.99]], c: [120, 85, 60], k: 1, capa: 1 },     // puerta
        ...caja(-3.5, 0, 3, -1.5, 0.8, 4.2, [200, 195, 175]),                                  // sofá
        ...caja(0.5, 0, 5, 2, 0.75, 6.2, [70, 55, 45]),                                        // mesa
      ];
    },
    ruido: 12,
  },
  {
    nombre: 'escalera',
    descripcion: 'Escalera recta (huella 28, tabica 17 → 31,3°) vista desde arriba en diagonal, con zanca, rodapié y barandilla',
    camara: { posicion: [2.6, 2.4, 1.2], guinada: -30, cabeceo: 16 },
    pendientes: [{ dir: [0, 0.17, 0.28], grados: Math.atan2(0.17, 0.28) * 180 / Math.PI }],
    polys: () => {
      const MADERA = [150, 85, 50], PARED = [232, 230, 224], HIERRO = [35, 35, 38], ZANCA = [90, 55, 35];
      const z0 = 3, n = 14, h = 0.17, t = 0.28;
      const zf = z0 + n * t, yf = n * h;
      const out = [...suelo(-4, 6, -1, 12, 1, [175, 125, 85])];
      out.push({ p: [[-0.6, 0, -1], [-0.6, 5, -1], [-0.6, 5, 12], [-0.6, 0, 12]], c: PARED, k: 0.92 });   // pared izquierda
      for (let i = 0; i < n; i++) out.push(...caja(-0.6, 0, z0 + i * t, 0.6, (i + 1) * h, z0 + (i + 1) * t + 0.03, MADERA));
      // rodapié inclinado sobre la pared (franja paralela a la pendiente)
      out.push({ p: [[-0.59, h + 0.02, z0], [-0.59, yf + h + 0.02, zf], [-0.59, yf + h + 0.14, zf], [-0.59, h + 0.14, z0]], c: [250, 250, 248], k: 1, capa: 1 });
      // zanca exterior (cara lateral inclinada, cubre las cabezas de los peldaños)
      out.push({ p: [[0.61, -0.05, z0 - 0.05], [0.61, yf - 0.05, zf - 0.05], [0.61, yf + 0.08, zf], [0.61, 0.08, z0]], c: ZANCA, k: 0.8, capa: 1 });
      out.push({ p: [[0.61, 0, z0], [0.61, 0, z0 + 0.4], [0.61, -0.05, z0 + 0.4], [0.61, -0.05, z0]], c: ZANCA, k: 0.8, capa: 1 });
      // barandilla: pasamanos y listón intermedio paralelos a la pendiente, montantes verticales
      for (const [y1, y2] of [[0.9, 0.96], [0.45, 0.48]]) {
        out.push({ p: [[0.68, y1, z0], [0.68, yf + y1, zf], [0.68, yf + y2, zf], [0.68, y2, z0]], c: HIERRO, k: 1, capa: 2 });
      }
      for (let i = 0; i <= n; i += 3) {
        const z = z0 + i * t + 0.1, y = i * h;
        out.push({ p: [[0.68, y, z], [0.68, y + 0.92, z], [0.68, y + 0.92, z + 0.04], [0.68, y, z + 0.04]], c: HIERRO, k: 1, capa: 2 });
      }
      return out;
    },
    ruido: 8,
  },
  {
    nombre: 'sin-estructura',
    descripcion: 'Vegetación y curvas: debe decir "no se detectan líneas fiables"',
    organica: true,
  },
];

/**
 * Dibuja la escena en un lienzo y devuelve la verdad conocida:
 * direcciones de los ejes del mundo (x, y=vertical, z) en coordenadas de cámara.
 */
export function generar(escena, ancho = 1280, alto = 960) {
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho; lienzo.height = alto;
  const ctx = lienzo.getContext('2d');
  if (escena.organica) {
    dibujarOrganica(ctx, ancho, alto, 7);
    return { lienzo, verdad: null };
  }
  const focalPx = escena.focalMM ? (escena.focalMM / 43.267) * Math.hypot(ancho, alto) : F26;
  const cam = crearCamara({ ancho, alto, focalPx, ...escena.camara });
  dibujar(ctx, cam, escena.polys(), escena.ruido, 42);
  if (escena.vegetacion) {
    // manchas orgánicas sobre la franja izquierda de la imagen
    let s = 11;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 160; i++) {
      ctx.beginPath();
      ctx.ellipse(rnd() * ancho * escena.vegetacion, alto * (0.2 + rnd() * 0.8), 8 + rnd() * 50, 8 + rnd() * 40, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${80 + rnd() * 60},${30 + rnd() * 40}%,${15 + rnd() * 40}%)`;
      ctx.fill();
    }
  }
  return {
    lienzo,
    verdad: {
      focalPx,
      ejes: { x: cam.direccion([1, 0, 0]), vertical: cam.direccion([0, 1, 0]), z: cam.direccion([0, 0, 1]) },
      pendientes: (escena.pendientes || []).map((p) => ({ dir: cam.direccion(p.dir), grados: p.grados })),
    },
  };
}
