// =============================================================================
// fuga.js — búsqueda de puntos de fuga con RANSAC.
//
// Principio (explicable en clase): rectas paralelas en el espacio convergen en
// la imagen en un mismo punto de fuga. Si elegimos al azar dos segmentos y los
// prolongamos, su corte es un CANDIDATO a punto de fuga. Contamos cuántos
// segmentos más "apuntan" a ese candidato (error angular pequeño). Repetimos
// muchas veces y nos quedamos con el candidato más votado: eso es RANSAC
// (Fischler y Bolles, 1981). Después retiramos esos segmentos y buscamos el
// siguiente punto de fuga, hasta un máximo de tres.
//
// El voto se mide en GRADOS (ángulo entre el segmento y la dirección hacia el
// punto), no en píxeles: así funciona igual con puntos lejanos o en el infinito.
// =============================================================================

import { cruz, normalizar, punto3, aEsfera, aImagen, errorAngular, autovectorMenor, anguloDirecciones } from './geometria.js';

/**
 * Prepara los datos de cada segmento: punto medio, dirección, longitud y la
 * normal del "plano de interpretación" (plano que contiene la cámara y el segmento).
 */
export function prepararSegmentos(segmentos, n, cam) {
  const datos = [];
  for (let i = 0; i < n; i++) {
    const x1 = segmentos[i * 4], y1 = segmentos[i * 4 + 1];
    const x2 = segmentos[i * 4 + 2], y2 = segmentos[i * 4 + 3];
    const L = Math.hypot(x2 - x1, y2 - y1);
    datos.push({
      i, L,
      mx: (x1 + x2) / 2, my: (y1 + y2) / 2,
      dx: (x2 - x1) / L, dy: (y2 - y1) / L,
      normal: normalizar(cruz(aEsfera(x1, y1, cam), aEsfera(x2, y2, cam))),
    });
  }
  return datos;
}

/** Error angular (grados) de un segmento respecto a una dirección de fuga v (esfera). */
export function errorSegmento(s, v, cam) {
  return errorAngular(s.mx, s.my, s.dx, s.dy, aImagen(v, cam));
}

/** Ajuste por mínimos cuadrados: dirección más perpendicular a todas las normales. */
function refinar(inliers, cam) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const s of inliers) {
    const n = s.normal, w = s.L;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += w * n[a] * n[b];
  }
  return autovectorMenor(M);
}

/** ¿Cuántas rectas realmente distintas hay? (trozos de una misma arista cuentan como una) */
function rectasDistintas(inliers) {
  const representantes = [];
  for (const s of inliers) {
    if (!representantes.some((r) => anguloDirecciones(r, s.normal) < 1)) representantes.push(s.normal);
    if (representantes.length >= 10) break;
  }
  return representantes.length;
}

/**
 * Busca hasta cfg.maxFamilias familias de segmentos convergentes.
 * Devuelve [{ v (dirección en la esfera), inliers: [índices], longitud }].
 */
export function detectarFamilias(datos, cam, cfg, opciones) {
  const { iteraciones, lado, rng } = opciones;
  const familias = [];
  let restantes = datos.slice();
  const longitudTotal = datos.reduce((t, s) => t + s.L, 0) || 1;

  for (let f = 0; f < cfg.maxFamilias; f++) {
    if (restantes.length < cfg.minSegmentosFamilia) break;

    // muestreo proporcional a la longitud: los segmentos largos son más fiables
    const acumulada = [];
    let total = 0;
    for (const s of restantes) { total += s.L; acumulada.push(total); }
    const elegir = () => {
      const r = rng() * total;
      let lo = 0, hi = acumulada.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (acumulada[m] < r) lo = m + 1; else hi = m; }
      return restantes[lo];
    };

    let mejor = null, mejorPuntuacion = 0;
    const umbral = cfg.umbralInlier;
    for (let it = 0; it < iteraciones; it++) {
      const a = elegir(), b = elegir();
      if (a === b) continue;
      const v = cruz(a.normal, b.normal);
      if (Math.hypot(v[0], v[1], v[2]) < 1e-9) continue; // misma recta
      const vn = normalizar(v);
      const V = aImagen(vn, cam);
      let puntuacion = 0;
      for (const s of restantes) {
        const e = errorAngular(s.mx, s.my, s.dx, s.dy, V);
        if (e < umbral) puntuacion += s.L * (1 - (e / umbral) ** 2);
      }
      if (puntuacion > mejorPuntuacion) { mejorPuntuacion = puntuacion; mejor = vn; }
    }
    if (!mejor) break;

    // refinado: inliers → mínimos cuadrados → inliers de nuevo (dos vueltas)
    let v = mejor, inliers = [];
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      inliers = restantes.filter((s) => errorSegmento(s, v, cam) < umbral);
      if (inliers.length < 2) break;
      v = refinar(inliers, cam);
    }
    inliers = restantes.filter((s) => errorSegmento(s, v, cam) < umbral);

    const longitud = inliers.reduce((t, s) => t + s.L, 0);
    const distintas = rectasDistintas(inliers);
    const valida =
      inliers.length >= cfg.minSegmentosFamilia &&
      longitud >= cfg.minLongitudFamiliaRel * lado &&
      distintas >= cfg.minRectasDistintas &&
      // la familia principal debe explicar una parte importante de todas las
      // líneas rectas: en vegetación o texturas siempre hay "coincidencias"
      // casuales, pero ninguna domina la imagen como lo hace la arquitectura
      (f > 0 || longitud / longitudTotal >= cfg.fraccionMinimaPrincipal);
    if (!valida) break; // si la familia más votada no es fiable, las siguientes tampoco

    // sentido canónico: z ≥ 0 (delante de la cámara) para comparar entre fotogramas
    if (v[2] < 0 || (v[2] === 0 && v[1] < 0)) v = [-v[0], -v[1], -v[2]];
    familias.push({ v, inliers: inliers.map((s) => s.i), longitud, rectasDistintas: distintas, fraccion: longitud / longitudTotal });
    const fuera = new Set(inliers);
    restantes = restantes.filter((s) => !fuera.has(s));
  }
  return familias;
}

/** Residual (grados) de cada segmento de una familia respecto a su punto de fuga. */
export function residuales(datosFamilia, V) {
  return datosFamilia.map((s) => errorAngular(s.mx, s.my, s.dx, s.dy, V));
}

export { punto3 };

/**
 * Búsqueda GUIADA de una familia cuya dirección ya se intuye.
 *
 * En arquitectura ortogonal, si conocemos la vertical y una dirección
 * horizontal, la tercera es perpendicular a ambas (producto vectorial). Esa
 * familia —típicamente la de "profundidad" en un interior— suele tener pocas
 * líneas y no supera los criterios de la búsqueda libre. Aquí solo se aceptan
 * candidatos dentro de un cono alrededor de la dirección prevista, y por eso
 * se pueden exigir menos líneas sin riesgo de inventar.
 */
export function buscarFamiliaGuiada(restantes, vPrevista, cam, cfg, opciones) {
  const { iteraciones, lado, rng } = opciones;
  if (restantes.length < cfg.minSegmentosGuiada) return null;
  const umbral = cfg.umbralInlier;
  const puntuar = (v) => {
    const V = aImagen(v, cam);
    let p = 0;
    for (const s of restantes) {
      const e = errorAngular(s.mx, s.my, s.dx, s.dy, V);
      if (e < umbral) p += s.L * (1 - (e / umbral) ** 2);
    }
    return p;
  };
  let mejor = vPrevista, mejorP = puntuar(vPrevista);
  for (let it = 0; it < iteraciones; it++) {
    const a = restantes[Math.floor(rng() * restantes.length)];
    const b = restantes[Math.floor(rng() * restantes.length)];
    if (a === b) continue;
    const v = cruz(a.normal, b.normal);
    if (Math.hypot(v[0], v[1], v[2]) < 1e-9) continue;
    const vn = normalizar(v);
    if (anguloDirecciones(vn, vPrevista) > cfg.conoGuiadoGrados) continue;
    const p = puntuar(vn);
    if (p > mejorP) { mejorP = p; mejor = vn; }
  }
  let v = mejor, inliers = [];
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    inliers = restantes.filter((s) => errorSegmento(s, v, cam) < umbral);
    if (inliers.length < 2) break;
    const vr = refinar(inliers, cam);
    if (anguloDirecciones(vr, vPrevista) > cfg.conoGuiadoGrados) break;
    v = vr;
  }
  inliers = restantes.filter((s) => errorSegmento(s, v, cam) < umbral);
  const longitud = inliers.reduce((t, s) => t + s.L, 0);
  const distintas = rectasDistintas(inliers);
  if (inliers.length < cfg.minSegmentosGuiada || longitud < cfg.minLongitudGuiadaRel * lado || distintas < cfg.minRectasGuiada) return null;
  if (v[2] < 0 || (v[2] === 0 && v[1] < 0)) v = [-v[0], -v[1], -v[2]];
  return { v, inliers: inliers.map((s) => s.i), longitud, rectasDistintas: distintas, fraccion: 0, guiada: true };
}
