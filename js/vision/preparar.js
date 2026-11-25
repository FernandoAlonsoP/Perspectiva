// =============================================================================
// preparar.js — reduce una imagen (vídeo, foto o lienzo) y la pasa a grises.
// Se ejecuta en el hilo principal porque necesita un <canvas>.
// =============================================================================

let lienzo = null;

/**
 * @param fuente  HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
 * @param anchoF, altoF  tamaño de la fuente
 * @param ladoMax lado largo de la copia de análisis
 * @returns { gris: Float32Array, ancho, alto, escala }
 */
export function prepararGris(fuente, anchoF, altoF, ladoMax) {
  const escalaRed = Math.min(1, ladoMax / Math.max(anchoF, altoF));
  const ancho = Math.max(1, Math.round(anchoF * escalaRed));
  const alto = Math.max(1, Math.round(altoF * escalaRed));
  if (!lienzo) lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(fuente, 0, 0, ancho, alto);
  const px = ctx.getImageData(0, 0, ancho, alto).data;
  const gris = new Float32Array(ancho * alto);
  for (let i = 0, j = 0; i < gris.length; i++, j += 4) {
    // luminancia (Rec. 601)
    gris[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
  }
  return { gris, ancho, alto, escala: anchoF / ancho };
}
