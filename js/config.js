// =============================================================================
// config.js — TODOS los parámetros de la app en un único lugar.
//
// Si un resultado no convence, se ajusta aquí, no dentro del algoritmo.
// Cada exportación JSON guarda una copia de estos valores para poder
// reproducir y comparar resultados (necesario para el estudio docente).
// =============================================================================

export const VERSION = '0.6.0';

// Autoría y créditos (pantalla de inicio, Ajustes → Acerca de, exportaciones)
export const CREDITOS = {
  app: 'Perspectiva',
  institucion: 'Universidad de Navarra',
  asignatura: 'Expresión Gráfica Arquitectónica',
  autores: 'Carlos Naya Villaverde (Doctor Arquitecto) y Fernando M. Alonso Pedrero (Doctor Arquitecto)',
  cargo: 'Profesores de la Universidad de Navarra',
  anio: 2026,
  ia: 'Desarrollada con la asistencia de Claude Opus 5.5 (Anthropic)',
};

export const CONFIG = {
  // --- Imagen de análisis -------------------------------------------------
  // El análisis se hace sobre una copia reducida de la imagen (más rápido).
  ladoAnalisisVivo: 640,     // px del lado largo en modo vivo
  ladoAnalisisAlto: 1024,    // px del lado largo al congelar o cargar foto
  fpsAnalisis: 5,            // análisis por segundo en modo vivo (el vídeo sigue a 30 fps)

  // --- Detector de segmentos (inspirado en LSD, von Gioi et al. 2010) ------
  desenfoqueSigma: 0.8,      // suavizado previo para reducir ruido del sensor
  umbralGradiente: 5.2,      // módulo mínimo de gradiente (0–255) para considerar un píxel
  toleranciaAngulo: 22.5,    // grados: píxeles "alineados" si su orientación difiere menos
  regionMinima: 12,          // píxeles mínimos de una región para ser candidata a segmento
  densidadMinima: 0.6,       // fracción de píxeles alineados dentro del rectángulo ajustado
  longitudMinimaRel: 0.025,  // longitud mínima del segmento, relativa al lado largo
  anchoMaximoRel: 0.18,      // anchura/longitud máxima (descarta manchas y curvas)

  // Fusión de segmentos colineales (una arista partida en trozos → un segmento)
  fusionAngulo: 1.5,         // grados
  fusionDistancia: 1.5,      // px (en imagen de análisis) de separación perpendicular
  fusionHuecoRel: 0.03,      // hueco máximo entre trozos, relativo al lado largo

  // --- Puntos de fuga (RANSAC) ---------------------------------------------
  maxFamilias: 4,            // 3 direcciones ortogonales + 1 pendiente (escalera, rampa, cubierta)
  iteracionesVivo: 250,
  iteracionesAlto: 1500,
  umbralInlier: 2.0,         // grados: un segmento "apunta" al punto de fuga si su error es menor
  minSegmentosFamilia: 5,    // segmentos mínimos para aceptar una familia
  minLongitudFamiliaRel: 0.6,// suma de longitudes mínima, relativa al lado largo
  minRectasDistintas: 3,     // rectas distintas (no trozos de la misma arista)
  fraccionMinimaPrincipal: 0.25, // la 1.ª familia debe sumar ≥ 25 % de la longitud de todos los segmentos
  semilla: 20261125,

  // Búsqueda guiada de la 3.ª dirección (perpendicular a la vertical y a una horizontal)
  conoGuiadoGrados: 20,      // solo candidatos a menos de N° de la dirección prevista
  minSegmentosGuiada: 3,     // al estar guiada, basta con menos evidencia…
  minLongitudGuiadaRel: 0.25,
  minRectasGuiada: 2,        // …pero al menos dos rectas distintas         // semilla aleatoria fija: resultados reproducibles

  // --- Cámara y focal ----------------------------------------------------------
  focalDefectoMM: 26,        // focal equivalente 35 mm típica de la cámara principal de un móvil
  focalMinMM: 12,            // rango plausible para aceptar una focal estimada de la escena
  focalMaxMM: 120,

  // --- Clasificación de familias -----------------------------------------------
  toleranciaVertical: 15,    // grados entre una familia y la vertical para llamarla "vertical"
  toleranciaHorizontal: 8,   // grados de inclinación máxima para llamarla "horizontal" (más: pendiente)
  verticalImagenGrados: 25,  // las líneas de la familia vertical son casi verticales EN LA IMAGEN
  verticalSensorGrados: 15,  // y (con sensor) su punto de fuga está en la dirección de la gravedad
  pendienteMinima: 15,       // grados: por debajo no es escalera/cubierta, sino horizontal mal medida
  alineacionPendiente: 10,   // grados: la planta de una pendiente debe seguir una dirección del edificio
  toleranciaManhattan: 3,    // grados de margen para considerar dos direcciones perpendiculares
  focalDispersion: 1.7,      // preferencia por focales de móvil: desviación típica (factor) sobre 26 mm
  umbralInclinacionCamara: 4,// grados: a partir de aquí las verticales convergen visiblemente

  // --- Seguimiento en vivo (suavizado entre fotogramas) ----------------------
  suavizado: 0.35,           // peso del fotograma nuevo (0 = congelado, 1 = sin suavizar)
  emparejamientoGrados: 6,   // dos familias de fotogramas sucesivos son la misma si difieren menos
  fotogramasParaMostrar: 2,  // una familia debe verse N análisis seguidos antes de dibujarse
  fotogramasParaOlvidar: 3,  // se deja de dibujar si falta N análisis seguidos

  // --- Dibujo ---------------------------------------------------------------
  lineasPorFamilia: 5,       // líneas de fuga dibujadas por familia (las más largas y bien repartidas)
  distanciaConvergencia: 8,  // anchos de imagen: más lejos, las líneas se ven paralelas (no se dibuja abanico vertical)
  rayosRejilla: 14,          // rayos de la rejilla de perspectiva por punto de fuga
  distanciaInfinito: 25,     // a partir de N anchos de imagen el punto se muestra como "∞"
};

// Colores por tipo de familia (contraste alto sobre fotografía)
export const COLORES = {
  horizontal: ['#ff4d4d', '#3d9bff'],  // rojo, azul
  vertical: '#2ee07a',                 // verde
  inclinada: '#ffb020',                // naranja (rampas, cubiertas…)
  horizonte: '#ffe14d',                // amarillo
  sensor: '#ffffff',
  suelto: 'rgba(255,255,255,0.35)',
};
