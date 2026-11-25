// =============================================================================
// analisis.js — la cadena completa: imagen → segmentos → puntos de fuga →
// focal → clasificación → horizonte. Lo usan el Web Worker y las pruebas.
//
// Todo el resultado se devuelve en píxeles de la imagen ORIGINAL (no de la
// copia reducida), para que la interfaz y la exportación no tengan que convertir.
// =============================================================================

import { CONFIG } from '../config.js';
import { detectarSegmentos } from './segmentos.js';
import { prepararSegmentos, detectarFamilias } from './fuga.js';
import { estimarFocal, clasificar, calcularHorizonte, horizonteSensor, imagenAEsfera } from './manhattan.js';
import { aImagen, aleatorio, mmAPx, pxAMm, rectaDesdeNormal, errorAngular } from './geometria.js';

/**
 * @param gris      Float32Array con la imagen reducida en grises (0–255)
 * @param ancho     ancho de la imagen reducida
 * @param alto      alto de la imagen reducida
 * @param op        { calidad: 'vivo'|'alto', escala: original/reducida,
 *                    focalMM: número|null (fija: EXIF o usuario), fuenteFocal,
 *                    arriba: [x,y,z]|null (sensor, coordenadas de cámara) }
 */
export function analizar(gris, ancho, alto, op = {}, cfg = CONFIG) {
  const t0 = performance.now();
  const lado = Math.max(ancho, alto);
  const escala = op.escala || 1;
  const arriba = op.arriba || null;

  // 1. Segmentos
  const { segmentos, n } = detectarSegmentos(gris, ancho, alto, cfg);
  const t1 = performance.now();

  // 2. Puntos de fuga con una focal provisional
  const focalFija = op.focalMM != null;
  const mm0 = focalFija ? op.focalMM : cfg.focalDefectoMM;
  let cam = { f: mmAPx(mm0, ancho, alto), cx: ancho / 2, cy: alto / 2 };
  const datos = prepararSegmentos(segmentos, n, cam);
  const familias = detectarFamilias(datos, cam, cfg, {
    iteraciones: op.calidad === 'alto' ? cfg.iteracionesAlto : cfg.iteracionesVivo,
    lado,
    rng: aleatorio(cfg.semilla),
  });

  // 3. Focal: fija (EXIF/usuario), estimada de la escena, o por defecto
  let fuenteFocal = focalFija ? op.fuenteFocal || 'usuario' : 'por defecto';
  if (!focalFija && familias.length >= 2) {
    const est = estimarFocal(familias, cam, ancho, alto, cfg);
    if (est) {
      // los puntos de fuga en la imagen no cambian; sus direcciones 3D sí
      const puntos = familias.map((f) => aImagen(f.v, cam));
      cam = { ...cam, f: est.f };
      familias.forEach((f, i) => { f.v = imagenAEsfera(puntos[i], cam); });
      fuenteFocal = 'escena';
    }
  }

  // 4. Clasificación y horizonte
  clasificar(familias, arriba, cfg);
  const hz = calcularHorizonte(familias, arriba);

  // 5. Residuales por segmento y resultado en píxeles de la imagen original
  const familiaSeg = new Int8Array(n).fill(-1);
  const residualSeg = new Float32Array(n);
  const salida = familias.map((f, k) => {
    const V = aImagen(f.v, cam);
    let suma = 0;
    for (const i of f.inliers) {
      const s = datos[i];
      const e = errorAngular(s.mx, s.my, s.dx, s.dy, V);
      familiaSeg[i] = k;
      residualSeg[i] = e;
      suma += e;
    }
    return {
      v: f.v,
      punto: [V[0] * escala, V[1] * escala, V[2]],
      tipo: f.tipo,
      nSegmentos: f.inliers.length,
      longitudRel: f.longitud / lado,
      rectasDistintas: f.rectasDistintas,
      fraccion: f.fraccion,
      residualMedio: f.inliers.length ? suma / f.inliers.length : 0,
    };
  });

  const camOriginal = { f: cam.f * escala, cx: cam.cx * escala, cy: cam.cy * escala };
  for (let i = 0; i < segmentos.length; i++) segmentos[i] *= escala;

  const fiable = familias.length > 0;
  let mensaje = '';
  if (!fiable) mensaje = 'No se detectan líneas fiables. Encuadra arquitectura con aristas rectas.';
  else if (familias.length === 1) mensaje = 'Solo una familia de líneas. Gira un poco para ver otra cara.';

  return {
    ancho: ancho * escala,
    alto: alto * escala,
    cam: camOriginal,
    focalMM: pxAMm(cam.f, ancho, alto),
    fuenteFocal,
    segmentos,
    familiaSeg,
    residualSeg,
    familias: salida,
    horizonte: hz ? { linea: rectaDesdeNormal(hz.normal, camOriginal), normal: hz.normal, fuente: hz.fuente } : null,
    horizonteSensor: horizonteSensor(arriba, camOriginal),
    fiable,
    mensaje,
    tiempos: { segmentos: t1 - t0, total: performance.now() - t0 },
    nSegmentos: n,
  };
}
