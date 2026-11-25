// =============================================================================
// exportar.js — guarda la imagen con la superposición (PNG) y un registro
// (JSON) con el modo, los parámetros y las medidas. Sin datos personales.
// El JSON es el dato que se usará en el estudio docente.
// =============================================================================

import { CONFIG, VERSION, CREDITOS } from './config.js';
import { dibujarSuperposicion } from './overlay.js';
import { aCartesiano } from './vision/geometria.js';

const LADO_MAX_EXPORTACION = 2048;

function marcaTemporal(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

/** Construye el registro JSON. */
export function construirRegistro(r, contexto) {
  return {
    app: 'perspectiva',
    version: VERSION,
    institucion: CREDITOS.institucion,
    autores: `© ${CREDITOS.anio} ${CREDITOS.autores}`,
    desarrollo: CREDITOS.ia,
    fecha: new Date().toISOString(),
    modo: contexto.modo === 'B' ? 'B · muestra + desviación' : 'A · solo muestra',
    origen: contexto.origen,                 // 'camara' | 'foto'
    imagen: { ancho: Math.round(r.ancho), alto: Math.round(r.alto) },
    camara: {
      focalEquivalenteMM: r.focalMM != null ? +r.focalMM.toFixed(1) : null,
      fuenteFocal: r.fuenteFocal,
      sensores: contexto.inclinacion
        ? { cabeceoGrados: +contexto.inclinacion.cabeceo.toFixed(1), alabeoGrados: +contexto.inclinacion.alabeo.toFixed(1) }
        : null,
    },
    deteccion: {
      fiable: !!r.fiable,
      mensaje: r.mensaje || '',
      segmentosDetectados: r.segmentos.length / 4,
      tiempoMs: r.tiempos ? Math.round(r.tiempos.total) : null,
      comprobacion: r.comprobacion || null,   // horizonte vs. sensor y ortogonalidad, en grados
    },
    puntosFuga: r.familias.map((f) => {
      const c = aCartesiano(f.punto);
      return {
        etiqueta: f.etiqueta,
        tipo: f.tipo,
        x: c ? +c[0].toFixed(1) : null,       // null = en el infinito (rectas paralelas)
        y: c ? +c[1].toFixed(1) : null,
        homogeneo: f.punto.map((n) => +n.toPrecision(6)),
        direccion3D: f.v ? f.v.map((n) => +n.toFixed(5)) : null,
        segmentos: f.nSegmentos,
        residualMedioGrados: +f.residualMedio.toFixed(3),
        ajustadoAMano: !!f.manual,
        busquedaGuiada: !!f.guiada,
      };
    }),
    horizonte: r.horizonte
      ? { recta_abc: r.horizonte.linea.map((n) => +n.toPrecision(6)), fuente: r.horizonte.fuente, ajustadoAMano: !!r.horizonte.manual }
      : null,
    residualesPorSegmentoGrados: Array.from(r.residualSeg).map((e, i) => (r.familiaSeg[i] >= 0 ? +e.toFixed(3) : null)),
    parametros: CONFIG,
  };
}

/** Pie discreto con la autoría, abajo a la derecha. */
function pie(ctx, W, H) {
  const t = Math.max(11, Math.round(Math.min(W, H) / 70));
  ctx.save();
  ctx.font = `500 ${t}px system-ui, sans-serif`;
  const texto = `${CREDITOS.app} · ${CREDITOS.institucion}`;
  const w = ctx.measureText(texto).width;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(W - w - 2.2 * t, H - 2.2 * t, w + 1.4 * t, 1.6 * t);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textBaseline = 'middle';
  ctx.fillText(texto, W - w - 1.5 * t, H - 1.4 * t);
  ctx.restore();
}

/**
 * Genera la imagen con la superposición. Si `marco` (px de imagen) es mayor que
 * la foto —vista alejada—, se exporta también el espacio exterior con las
 * líneas llegando a sus puntos de fuga.
 */
async function construirImagen(fuente, r, contexto) {
  const m = contexto.marco || { x0: 0, y0: 0, x1: r.ancho, y1: r.alto };
  const anchoM = m.x1 - m.x0, altoM = m.y1 - m.y0;
  const s = Math.min(LADO_MAX_EXPORTACION / Math.max(anchoM, altoM), contexto.marco ? 4 : 1);
  const c = document.createElement('canvas');
  c.width = Math.round(anchoM * s);
  c.height = Math.round(altoM * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, c.width, c.height);
  const T = { escala: s, ox: -m.x0 * s, oy: -m.y0 * s };
  ctx.drawImage(fuente, T.ox, T.oy, r.ancho * s, r.alto * s);
  if (contexto.marco) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(T.ox, T.oy, r.ancho * s, r.alto * s);
  }
  dibujarSuperposicion(ctx, r, T, {
    modo: contexto.modo, rejilla: contexto.rejilla, aristas: contexto.aristas, compararSensor: contexto.compararSensor,
    g: Math.max(1.5, Math.min(c.width, c.height) / 600), seleccion: null,
  });
  pie(ctx, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, 'image/png'));
}

export async function exportar(fuente, r, contexto) {
  const nombre = `perspectiva-${marcaTemporal()}`;
  const png = await construirImagen(fuente, r, contexto);
  const json = new Blob([JSON.stringify(construirRegistro(r, contexto), null, 2)], { type: 'application/json' });
  const archivos = [new File([png], `${nombre}.png`, { type: 'image/png' }), new File([json], `${nombre}.json`, { type: 'application/json' })];
  if (contexto.incluirOriginal) {
    // la foto limpia, sin superposición (para comparar, o para que el profesor la reanalice)
    const c = document.createElement('canvas');
    c.width = Math.round(r.ancho); c.height = Math.round(r.alto);
    c.getContext('2d').drawImage(fuente, 0, 0, c.width, c.height);
    const jpg = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
    archivos.push(new File([jpg], `${nombre}-original.jpg`, { type: 'image/jpeg' }));
  }

  // En el móvil, la hoja de "Compartir" permite guardar en Fotos/Archivos o enviar al profesor
  if (navigator.canShare && navigator.canShare({ files: archivos })) {
    try {
      await navigator.share({ files: archivos, title: 'Perspectiva' });
      return 'compartido';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelado';
      // si falla, se descarga
    }
  }
  for (const f of archivos) {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url; a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return 'descargado';
}
