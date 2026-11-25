// =============================================================================
// main.js — estado de la app, interfaz y bucle de dibujo.
//
// Flujo:
//   · Modo vivo: la cámara se dibuja a 30 fps; cada 200 ms se envía una copia
//     reducida al Web Worker; el resultado se suaviza (seguimiento.js) y se dibuja.
//   · Congelar / Foto: un único análisis de alta calidad; la superposición se
//     puede editar (arrastrar puntos de fuga y horizonte).
// =============================================================================

import { CONFIG, VERSION, COLORES } from './config.js';
import { iniciarCamara, detenerCamara } from './camara.js';
import { activarSensores, estadoSensores, arribaCamara, inclinacion } from './sensores.js';
import { prepararGris } from './vision/preparar.js';
import { horizonteSensor } from './vision/manhattan.js';
import { mmAPx } from './vision/geometria.js';
import { dibujarSuperposicion } from './overlay.js';
import { Seguidor } from './seguimiento.js';
import { instalarInteraccion } from './interaccion.js';
import { guiasManuales } from './edicion.js';
import { exportar } from './exportar.js';
import { leerFocal35 } from './exif.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const lienzo = $('lienzo');
const ctx = lienzo.getContext('2d');

// --- Estado -------------------------------------------------------------------
const AJUSTES_DEFECTO = { modo: 'A', rejilla: false, aristas: false, vivo: true, focalAuto: true, focalMM: CONFIG.focalDefectoMM };
const estado = {
  origen: null,          // 'camara' | 'foto'
  congelado: false,
  fuente: null,          // <video> o <canvas> con el fotograma congelado / la foto
  anchoF: 0, altoF: 0,
  resultado: null,       // lo que se dibuja ahora
  seleccion: null,       // índice de segmento (modo B)
  focalExif: null,
  inclinacionCongelada: null,
  analizando: false,
  ultimoAnalisis: 0,
  turno: 0,              // invalida análisis antiguos al cambiar de fuente
  error: '',
  T: { escala: 1, ox: 0, oy: 0 },
  ajustes: { ...AJUSTES_DEFECTO },
};

// El profesor puede fijar el modo por enlace (?modo=A o ?modo=B) para el estudio.
const parametros = new URLSearchParams(location.search);
const modoFijado = ['A', 'B'].includes(parametros.get('modo')) ? parametros.get('modo') : null;

try {
  const guardados = JSON.parse(localStorage.getItem('perspectiva.ajustes') || '{}');
  Object.assign(estado.ajustes, guardados);
} catch { /* navegación privada: se usan los valores por defecto */ }
if (modoFijado) estado.ajustes.modo = modoFijado;

function guardarAjustes() {
  try { localStorage.setItem('perspectiva.ajustes', JSON.stringify(estado.ajustes)); } catch { /* sin almacenamiento */ }
}

const seguidor = new Seguidor();

// --- Web Worker ---------------------------------------------------------------
const worker = new Worker(new URL('./vision/worker.js', import.meta.url), { type: 'module' });
let idPeticion = 0;
const pendientes = new Map();
worker.onmessage = (e) => {
  const p = pendientes.get(e.data.id);
  pendientes.delete(e.data.id);
  if (!p) return;
  if (e.data.error) p.rechazar(new Error(e.data.error));
  else p.resolver(e.data.resultado);
};
worker.onerror = () => {
  mostrarError('Este navegador no puede ejecutar el análisis. Actualiza Safari o Chrome.');
};

function focalFija() {
  if (!estado.ajustes.focalAuto) return { mm: estado.ajustes.focalMM, fuente: 'usuario' };
  if (estado.origen === 'foto' && estado.focalExif) return { mm: estado.focalExif, fuente: 'EXIF de la foto' };
  return null;
}

function analizarEnWorker(calidad) {
  const lado = calidad === 'alto' ? CONFIG.ladoAnalisisAlto : CONFIG.ladoAnalisisVivo;
  const g = prepararGris(estado.fuente, estado.anchoF, estado.altoF, lado);
  const focal = focalFija();
  const opciones = {
    calidad,
    escala: g.escala,
    // con una foto de la galería, la inclinación actual del móvil no dice nada
    arriba: estado.origen === 'camara' ? arribaCamara() : null,
    focalMM: focal ? focal.mm : null,
    fuenteFocal: focal ? focal.fuente : null,
  };
  const id = ++idPeticion;
  return new Promise((resolver, rechazar) => {
    pendientes.set(id, { resolver, rechazar });
    worker.postMessage({ id, gris: g.gris, ancho: g.ancho, alto: g.alto, opciones }, [g.gris.buffer]);
  });
}

// --- Análisis -----------------------------------------------------------------
function analisisVivo() {
  const turno = estado.turno;
  estado.analizando = true;
  estado.ultimoAnalisis = performance.now();
  analizarEnWorker('vivo')
    .then((r) => {
      if (turno !== estado.turno || estado.congelado) return;
      estado.resultado = seguidor.actualizar(r);
      estado.tiempoVivo = r.tiempos.total;
      estado.error = '';
    })
    .catch((e) => mostrarError(e.message))
    .finally(() => { estado.analizando = false; });
}

async function analisisAlto() {
  const turno = ++estado.turno;
  estado.resultado = null;
  estado.seleccion = null;
  mostrarMensaje('Analizando…');
  try {
    const r = await analizarEnWorker('alto');
    if (turno !== estado.turno) return;
    estado.aviso = null;
    if (r.familias.length === 0) {
      const arriba = estado.origen === 'camara' ? arribaCamara() : null;
      const focal = focalFija();
      const fpx = mmAPx(focal ? focal.mm : CONFIG.focalDefectoMM, estado.anchoF, estado.altoF);
      estado.resultado = guiasManuales(estado.anchoF, estado.altoF, arriba, fpx);
      estado.resultado.mensaje = 'No se detectan líneas fiables. Te dejo guías manuales para arrastrar.';
      estado.resultado.tiempos = r.tiempos;
    } else {
      estado.resultado = r;
    }
    estado.error = '';
  } catch (e) {
    mostrarError(e.message);
  }
}

// --- Fuentes: cámara, congelar, foto ----------------------------------------------
async function empezarCamara() {
  estado.turno++;
  estado.origen = 'camara';
  estado.congelado = false;
  estado.resultado = null;
  estado.seleccion = null;
  seguidor.reiniciar();
  mostrarApp();
  mostrarMensaje('Abriendo la cámara…');
  try {
    await iniciarCamara(video);
    estado.fuente = video;
    estado.error = '';
    mostrarMensaje('');
  } catch (e) {
    estado.origen = null;
    estado.fuente = null;
    mostrarError(e.message);
  }
  actualizarBotones();
}

function congelar() {
  if (estado.origen !== 'camara' || estado.congelado || !video.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  estado.fuente = c;
  estado.anchoF = c.width;
  estado.altoF = c.height;
  estado.congelado = true;
  estado.inclinacionCongelada = inclinacion(arribaCamara());
  video.pause();
  actualizarBotones();
  analisisAlto();
}

function reanudar() {
  if (estado.origen === 'foto' || !video.srcObject) { empezarCamara(); return; }
  estado.turno++;
  estado.congelado = false;
  estado.fuente = video;
  estado.resultado = null;
  estado.seleccion = null;
  seguidor.reiniciar();
  video.play();
  mostrarMensaje('');
  actualizarBotones();
}

async function cargarFoto(archivo) {
  if (!archivo) return;
  mostrarApp();
  mostrarMensaje('Cargando foto…');
  try {
    estado.focalExif = await leerFocal35(archivo);
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    // limitar el tamaño (memoria del móvil); el navegador ya aplica la orientación EXIF
    const s = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    detenerCamara();
    video.srcObject = null;
    estado.origen = 'foto';
    estado.fuente = c;
    estado.anchoF = c.width;
    estado.altoF = c.height;
    estado.congelado = true;
    estado.inclinacionCongelada = null;
    actualizarBotones();
    await analisisAlto();
  } catch {
    mostrarError('No se pudo abrir esa imagen. Prueba con una foto JPEG o PNG.');
  }
}

// --- Dibujo -------------------------------------------------------------------
const VACIO = { familias: [], segmentos: new Float32Array(0), familiaSeg: new Int8Array(0), residualSeg: new Float32Array(0), horizonte: null };

function ajustarLienzo() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(lienzo.clientWidth * dpr), h = Math.round(lienzo.clientHeight * dpr);
  if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
}

let ultimoIndicador = 0;
function bucle(t) {
  requestAnimationFrame(bucle);
  ajustarLienzo();
  const W = lienzo.width, H = lienzo.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  if (estado.fuente === video) {
    estado.anchoF = video.videoWidth;
    estado.altoF = video.videoHeight;
  }
  if (estado.fuente && estado.anchoF) {
    const s = Math.min(W / estado.anchoF, H / estado.altoF);
    estado.T = { escala: s, ox: (W - estado.anchoF * s) / 2, oy: (H - estado.altoF * s) / 2 };
    ctx.drawImage(estado.fuente, estado.T.ox, estado.T.oy, estado.anchoF * s, estado.altoF * s);

    // horizonte del sensor: en vivo se recalcula en cada fotograma
    let hs;
    if (estado.origen === 'camara' && !estado.congelado) {
      const cam = estado.resultado?.cam || {
        f: mmAPx(focalFija()?.mm || CONFIG.focalDefectoMM, estado.anchoF, estado.altoF),
        cx: estado.anchoF / 2, cy: estado.altoF / 2,
      };
      hs = horizonteSensor(arribaCamara(), cam);
    }
    const r = estado.resultado || VACIO;
    dibujarSuperposicion(ctx, r, estado.T, {
      modo: estado.ajustes.modo,
      rejilla: estado.ajustes.rejilla,
      aristas: estado.ajustes.aristas || (estado.ajustes.modo === 'B' && estado.congelado),
      seleccion: estado.seleccion,
      g: window.devicePixelRatio || 1,
      horizonteSensor: hs,
    });

    if (estado.origen === 'camara' && !estado.congelado && estado.ajustes.vivo && !estado.analizando &&
        t - estado.ultimoAnalisis > 1000 / CONFIG.fpsAnalisis && video.readyState >= 2) {
      analisisVivo();
    }
  }
  if (t - ultimoIndicador > 250) { ultimoIndicador = t; actualizarIndicadores(); }
}

// --- Interfaz -----------------------------------------------------------------
function mostrarApp() {
  $('inicio').hidden = true;
  $('app').hidden = false;
}

function pintarMensaje(texto) { $('mensaje').textContent = texto; $('mensaje').hidden = !texto; }
/** Aviso breve: tiene prioridad unos segundos sobre los mensajes del análisis. */
function mostrarMensaje(texto) { estado.aviso = texto ? { texto, t: performance.now() } : null; pintarMensaje(texto); }
function mostrarError(texto) { estado.error = texto; pintarMensaje(texto); }

function formato(n, d = 1) { return n.toFixed(d).replace('.', ','); }

function actualizarIndicadores() {
  // Sensores (texto corto: se lee de un vistazo)
  let textoSensor = '';
  if (estado.origen === 'foto') textoSensor = 'Foto de galería';
  else {
    const est = estadoSensores();
    const inc = estado.congelado ? estado.inclinacionCongelada : inclinacion(arribaCamara());
    if (inc) {
      const c = Math.abs(inc.cabeceo);
      textoSensor = c > CONFIG.umbralInclinacionCamara
        ? `Móvil inclinado ${formato(c, 0)}° ${inc.cabeceo > 0 ? '↑' : '↓'} · las verticales convergen`
        : 'Móvil a plomo · verticales paralelas';
      if (Math.abs(inc.alabeo) > 3) textoSensor += ` · girado ${formato(Math.abs(inc.alabeo), 0)}°`;
    } else if (est === 'denegado') textoSensor = 'Sin permiso de sensores';
    else if (est === 'inactivo') textoSensor = 'Sensores apagados';
    else textoSensor = '';
  }
  $('sensor').textContent = textoSensor;

  // Un único mensaje abajo, por prioridad: error > análisis > ayuda
  const r = estado.resultado;
  let texto = estado.error;
  let tenue = false;
  if (!texto && estado.aviso && performance.now() - estado.aviso.t < 2500) texto = estado.aviso.texto;
  if (!texto && estado.congelado && !r) texto = 'Analizando…';
  if (!texto && r && r.mensaje) texto = r.mensaje;
  if (!texto && !r && estado.origen === 'camara' && !estado.congelado) { texto = 'Buscando líneas…'; tenue = true; }
  if (!texto && estado.congelado && r && r.familias.length) {
    texto = estado.ajustes.modo === 'B'
      ? 'Toca una línea para ver su desviación, o arrastra un punto de fuga o el horizonte.'
      : 'Arrastra un punto de fuga o el horizonte para explorar el encaje.';
    tenue = true;
  }
  pintarMensaje(texto);
  $('mensaje').classList.toggle('tenue', tenue);

  // Focal (los milisegundos van a Ajustes)
  $('info').textContent = r && r.focalMM ? `Focal ≈ ${formato(r.focalMM, 0)} mm${r.fuenteFocal === 'por defecto' ? ' (supuesta)' : ''}` : '';
  const ms = r && r.tiempos ? Math.round(estado.congelado ? r.tiempos.total : estado.tiempoVivo || r.tiempos.total) : null;
  $('tecnico').textContent = r ? `Análisis: ${ms ?? '—'} ms · ${r.segmentos.length / 4} aristas · focal ${r.fuenteFocal}` : '';

  // Resumen del encaje (solo modo B)
  const resumen = $('resumen');
  if (estado.ajustes.modo === 'B' && r && r.familias.length) {
    resumen.hidden = false;
    resumen.replaceChildren(...r.familias.filter((f) => f.etiqueta).map((f) => {
      const p = document.createElement('div');
      const punto = document.createElement('span');
      punto.className = 'punto';
      punto.style.background = f.color;
      p.append(punto, `${f.etiqueta}: ${f.nSegmentos ? `desviación media ${formato(f.residualMedio)}° · ${f.nSegmentos} líneas` : 'sin líneas'}`);
      return p;
    }));
  } else resumen.hidden = true;
}

function actualizarBotones() {
  const b = $('btn-congelar');
  if (estado.origen === 'foto' || !estado.origen) { b.textContent = 'Cámara'; b.dataset.accion = 'camara'; }
  else if (estado.congelado) { b.textContent = 'Reanudar'; b.dataset.accion = 'reanudar'; }
  else { b.textContent = 'Congelar'; b.dataset.accion = 'congelar'; }
}

function sincronizarAjustes() {
  const a = estado.ajustes;
  document.querySelectorAll('input[name="modo"]').forEach((el) => { el.checked = el.value === a.modo; });
  $('fila-modo').hidden = !!modoFijado;
  $('modo-fijado').hidden = !modoFijado;
  $('modo-fijado').textContent = modoFijado ? `Modo ${modoFijado} fijado por el enlace del profesor.` : '';
  $('aj-rejilla').checked = a.rejilla;
  $('aj-aristas').checked = a.aristas;
  $('aj-vivo').checked = a.vivo;
  $('aj-focal-auto').checked = a.focalAuto;
  $('aj-focal').value = a.focalMM;
  $('aj-focal').disabled = a.focalAuto;
  $('aj-focal-valor').textContent = `${a.focalMM} mm`;
  const est = estadoSensores();
  $('estado-sensores').textContent = {
    activo: 'Activados', 'sin-datos': 'Activados, pero este dispositivo no envía datos',
    denegado: 'Denegados (puedes reactivarlos en los ajustes del navegador)', inactivo: 'Apagados', 'no-disponible': 'No disponibles',
  }[est] || est;
  $('version').textContent = `Versión ${VERSION}`;
}

// --- Eventos --------------------------------------------------------------------
$('btn-empezar').addEventListener('click', () => {
  activarSensores(); // en iPhone debe pedirse dentro del toque
  empezarCamara();
});
$('btn-foto-inicio').addEventListener('click', () => $('archivo').click());
$('btn-foto').addEventListener('click', () => $('archivo').click());
$('archivo').addEventListener('change', (e) => { cargarFoto(e.target.files[0]); e.target.value = ''; });

$('btn-congelar').addEventListener('click', (e) => {
  const accion = e.currentTarget.dataset.accion;
  if (accion === 'congelar') congelar();
  else if (accion === 'reanudar') reanudar();
  else { activarSensores(); empezarCamara(); }
});

$('btn-exportar').addEventListener('click', async () => {
  if (!estado.fuente || !estado.resultado) { mostrarMensaje('Nada que exportar todavía.'); return; }
  const inc = estado.congelado ? estado.inclinacionCongelada : inclinacion(arribaCamara());
  const r = await exportar(estado.fuente, estado.resultado, {
    modo: estado.ajustes.modo, origen: estado.origen,
    rejilla: estado.ajustes.rejilla, aristas: estado.ajustes.aristas,
    inclinacion: estado.origen === 'camara' ? inc : null,
  });
  if (r === 'descargado') mostrarMensaje('Imagen y registro descargados.');
});

$('btn-ajustes').addEventListener('click', () => { sincronizarAjustes(); $('ajustes').showModal(); });
$('btn-cerrar-ajustes').addEventListener('click', () => $('ajustes').close());
$('btn-sensores').addEventListener('click', async () => { await activarSensores(); setTimeout(sincronizarAjustes, 1600); sincronizarAjustes(); });

$('ajustes').addEventListener('change', (e) => {
  const a = estado.ajustes;
  const focalAntes = JSON.stringify([a.focalAuto, a.focalMM]);
  if (e.target.name === 'modo') { a.modo = e.target.value; estado.seleccion = null; }
  a.rejilla = $('aj-rejilla').checked;
  a.aristas = $('aj-aristas').checked;
  a.vivo = $('aj-vivo').checked;
  a.focalAuto = $('aj-focal-auto').checked;
  a.focalMM = Number($('aj-focal').value);
  guardarAjustes();
  sincronizarAjustes();
  // la focal cambia el horizonte y la clasificación: reanalizar la imagen congelada
  if (focalAntes !== JSON.stringify([a.focalAuto, a.focalMM])) {
    if (estado.congelado) analisisAlto(); else seguidor.reiniciar();
  }
});
$('aj-focal').addEventListener('input', () => { $('aj-focal-valor').textContent = `${$('aj-focal').value} mm`; });

instalarInteraccion(lienzo, {
  resultado: () => estado.resultado,
  transformacion: () => estado.T,
  editable: () => estado.congelado,
  modo: () => estado.ajustes.modo,
  seleccionar: (i) => { estado.seleccion = i; },
  cambiado: () => {},
});

window.addEventListener('pagehide', () => detenerCamara());

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* sin modo sin conexión */ });
}

// colores en la leyenda de la pantalla de inicio
document.querySelectorAll('[data-color]').forEach((el) => {
  const c = el.dataset.color;
  el.style.background = c === 'vertical' ? COLORES.vertical : c === 'horizonte' ? COLORES.horizonte : COLORES.horizontal[Number(c)];
});

// Ayuda para las pruebas automáticas (test/e2e.mjs): coordenadas CSS de elementos dibujados
window.__depuracion = {
  puntoDeLinea() {
    const r = estado.resultado, T = estado.T, dpr = window.devicePixelRatio || 1;
    if (!r) return null;
    let mejor = -1, L = 0;
    for (let i = 0; i < r.familiaSeg.length; i++) {
      if (r.familiaSeg[i] < 0) continue;
      const l = Math.hypot(r.segmentos[i * 4 + 2] - r.segmentos[i * 4], r.segmentos[i * 4 + 3] - r.segmentos[i * 4 + 1]);
      if (l > L) { L = l; mejor = i; }
    }
    if (mejor < 0) return null;
    const x = (r.segmentos[mejor * 4] + r.segmentos[mejor * 4 + 2]) / 2, y = (r.segmentos[mejor * 4 + 1] + r.segmentos[mejor * 4 + 3]) / 2;
    return [(T.ox + T.escala * x) / dpr, (T.oy + T.escala * y) / dpr];
  },
  puntoHorizonte() {
    const r = estado.resultado, T = estado.T, dpr = window.devicePixelRatio || 1;
    if (!r?.horizonte) return null;
    const [a, b, c] = r.horizonte.linea;
    const x = r.ancho / 2, y = -(a * x + c) / b;
    return [(T.ox + T.escala * x) / dpr, (T.oy + T.escala * y) / dpr];
  },
};

actualizarBotones();
requestAnimationFrame(bucle);
