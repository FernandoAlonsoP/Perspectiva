// =============================================================================
// exif.js — lee de una foto JPEG la focal equivalente en 35 mm (etiqueta EXIF
// 0xA405). Si existe, el análisis de esa foto usa la focal real de la cámara.
// Muchas fotos no la traen (capturas, imágenes editadas o reenviadas): entonces
// se estima de la escena.
// =============================================================================

export async function leerFocal35(archivo) {
  try {
    const buf = await archivo.slice(0, 256 * 1024).arrayBuffer();
    const d = new DataView(buf);
    if (d.getUint16(0) !== 0xffd8) return null; // no es JPEG
    let p = 2;
    while (p + 4 < d.byteLength) {
      const marca = d.getUint16(p);
      const largo = d.getUint16(p + 2);
      if (marca === 0xffe1 && d.getUint32(p + 4) === 0x45786966) return leerTiff(d, p + 10);
      if ((marca & 0xff00) !== 0xff00) return null;
      p += 2 + largo;
    }
  } catch { /* EXIF corrupto o ausente */ }
  return null;
}

function leerTiff(d, base) {
  const le = d.getUint16(base) === 0x4949;
  const u16 = (o) => d.getUint16(base + o, le);
  const u32 = (o) => d.getUint32(base + o, le);
  const buscar = (ifd, etiqueta) => {
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === etiqueta) return e;
    }
    return null;
  };
  const ifd0 = u32(4);
  const puntero = buscar(ifd0, 0x8769); // ExifIFDPointer
  if (puntero == null) return null;
  const exifIfd = u32(puntero + 8);
  const e = buscar(exifIfd, 0xa405); // FocalLengthIn35mmFilm (SHORT)
  if (e == null) return null;
  const v = u16(e + 8);
  return v > 0 ? v : null;
}
