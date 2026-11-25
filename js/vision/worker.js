// =============================================================================
// worker.js — el análisis corre en un hilo aparte (Web Worker) para que el
// vídeo y los botones no se bloqueen mientras se calculan los puntos de fuga.
// =============================================================================

import { analizar } from './analisis.js';

self.onmessage = (e) => {
  const { id, gris, ancho, alto, opciones } = e.data;
  try {
    const r = analizar(gris, ancho, alto, opciones);
    self.postMessage({ id, resultado: r }, [r.segmentos.buffer, r.familiaSeg.buffer, r.residualSeg.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
