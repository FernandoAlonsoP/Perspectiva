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
import { activarSensores, estadoSensores, arribaCamara, inclinacion, giroImagen, girarVector } from './sensores.js';
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
const AJUSTES_DEFECTO = { modo: 'A', rejilla: false, aristas: false, compararSensor: false, autoGiro: true, exportarOriginal: false, exportarRegistro: false, vivo: true, focalAuto: true, focalMM: CONFIG.focalDefectoMM };
const estado = {
  origen: null,          // 'camara' | 'foto'
  congelado: false,
  fuente: null,          // <video> o <canvas> con el fotograma congelado / la foto
  anchoF: 0, altoF: 0,   // tamaño de la imagen DERECHA (ya girada)
  imagen: null,          // lo que se dibuja, analiza y exporta: la fuente girada para que la escena quede derecha
  giro: 0,               // 0/90/180/270: cómo se sostiene el móvil (por gravedad)
  giroImagen: 0,         // giro aplicado al fotograma en vivo actual
  vista: { zoom: 1, cx: null, cy: null },  // zoom y centro (px de imagen) de la imagen congelada
  vistaFugas: false,     // ¿encuadre ampliado para ver los puntos de fuga?
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
  // v0.4.1: exportar solo la imagen por defecto (antes salían 3 archivos)
  if (!guardados.versionAjustes) { delete guardados.exportarOriginal; delete guardados.exportarRegistro; }
  guardados.versionAjustes = 2;
  Object.assign(estado.ajustes, guardados);
} catch { /* navegación privada: se usan los valores por defecto */ }
if (modoFijado) estado.ajustes.modo = modoFijado;
// ?registro=1 en el enlace: cada exportación incluye el JSON (para el estudio)
const registroForzado = parametros.get('registro') === '1';
if (registroForzado) estado.ajustes.exportarRegistro = true;

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
  const g = prepararGris(estado.imagen, estado.anchoF, estado.altoF, lado);
  const focal = focalFija();
  const opciones = {
    calidad,
    escala: g.escala,
    // con una foto de la galería, la inclinación actual del móvil no dice nada
    arriba: estado.origen === 'camara' ? arribaImagen() : null,
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
      const arriba = estado.origen === 'camara' ? arribaImagen() : null;
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
  estado.imagen = null;
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
  // se congela la imagen YA GIRADA (escena derecha)
  const c = girarFuente(video, video.videoWidth, video.videoHeight, estado.giroImagen, document.createElement('canvas'));
  estado.inclinacionCongelada = inclinacion(arribaImagen());
  estado.fuente = c;
  estado.imagen = c;
  estado.anchoF = c.width;
  estado.altoF = c.height;
  estado.congelado = true;
  reiniciarVista();
  video.pause();
  actualizarBotones();
  analisisAlto();
}

function reanudar() {
  if (estado.origen === 'foto' || !video.srcObject) { empezarCamara(); return; }
  estado.turno++;
  estado.congelado = false;
  reiniciarVista();
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
    estado.imagen = c;
    estado.anchoF = c.width;
    estado.altoF = c.height;
    estado.congelado = true;
    estado.inclinacionCongelada = null;
    reiniciarVista();
    actualizarBotones();
    await analisisAlto();
  } catch {
    mostrarError('No se pudo abrir esa imagen. Prueba con una foto JPEG o PNG.');
  }
}

// --- Giro: la escena siempre derecha ---------------------------------------------
const lienzoGiro = document.createElement('canvas');

/** Dibuja la fuente girada `giro` grados (horario) en un lienzo y lo devuelve. */
function girarFuente(fuente, w, h, giro, destino = lienzoGiro) {
  const lateral = giro === 90 || giro === 270;
  destino.width = lateral ? h : w;
  destino.height = lateral ? w : h;
  const c = destino.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (giro === 90) { c.translate(h, 0); c.rotate(Math.PI / 2); }
  else if (giro === 180) { c.translate(w, h); c.rotate(Math.PI); }
  else if (giro === 270) { c.translate(0, w); c.rotate(-Math.PI / 2); }
  c.drawImage(fuente, 0, 0, w, h);
  return destino;
}

/** "Arriba" del sensor en coordenadas de la imagen derecha. */
function arribaImagen() {
  return girarVector(arribaCamara(), estado.giroImagen);
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
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // ¿Cómo se sostiene el móvil? (funciona también con el bloqueo de rotación)
  const giroNuevo = estado.ajustes.autoGiro ? giroImagen(estado.giro) : 0;
  if (giroNuevo !== estado.giro) { estado.giro = giroNuevo; colocarHud(); }

  if (estado.fuente === video && video.videoWidth) {
    // en vivo, el fotograma se gira para que la escena quede derecha
    estado.giroImagen = estado.giro;
    estado.imagen = estado.giro ? girarFuente(video, video.videoWidth, video.videoHeight, estado.giro) : video;
    const lateral = estado.giro === 90 || estado.giro === 270;
    estado.anchoF = lateral ? video.videoHeight : video.videoWidth;
    estado.altoF = lateral ? video.videoWidth : video.videoHeight;
  } else if (estado.fuente !== video) {
    estado.imagen = estado.fuente;
  }

  if (estado.imagen && estado.anchoF) {
    // La imagen derecha se dibuja girada al revés: en pantalla se ve igual que
    // la cámara, pero los textos y las guías quedan derechos para quien mira.
    const lateral = estado.giro === 90 || estado.giro === 270;
    const Wl = lateral ? H : W, Hl = lateral ? W : H;   // tamaño lógico
    ctx.translate(W / 2, H / 2);
    ctx.rotate((-estado.giro * Math.PI) / 180);
    ctx.translate(-Wl / 2, -Hl / 2);
    estado.lienzoLogico = { Wl, Hl };

    // Encuadre: en vivo, la imagen entera; congelada, con zoom y desplazamiento
    const s0 = Math.min(Wl / estado.anchoF, Hl / estado.altoF);
    estado.escalaBase = s0;
    const v = estado.vista;
    if (!estado.congelado || v.cx == null) { v.zoom = 1; v.cx = estado.anchoF / 2; v.cy = estado.altoF / 2; }
    const s = s0 * v.zoom;
    estado.T = { escala: s, ox: Wl / 2 - v.cx * s, oy: Hl / 2 - v.cy * s };
    ctx.drawImage(estado.imagen, estado.T.ox, estado.T.oy, estado.anchoF * s, estado.altoF * s);
    if (v.zoom < 0.98) {
      // al alejar: borde fino para distinguir la foto del espacio exterior
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = window.devicePixelRatio || 1;
      ctx.strokeRect(estado.T.ox, estado.T.oy, estado.anchoF * s, estado.altoF * s);
    }

    // horizonte del sensor: en vivo se recalcula en cada fotograma
    let hs;
    if (estado.origen === 'camara' && !estado.congelado) {
      const cam = estado.resultado?.cam || {
        f: mmAPx(focalFija()?.mm || CONFIG.focalDefectoMM, estado.anchoF, estado.altoF),
        cx: estado.anchoF / 2, cy: estado.altoF / 2,
      };
      hs = horizonteSensor(arribaImagen(), cam);
    }
    const r = estado.resultado || VACIO;
    dibujarSuperposicion(ctx, r, estado.T, {
      modo: estado.ajustes.modo,
      rejilla: estado.ajustes.rejilla,
      aristas: estado.ajustes.aristas || (estado.ajustes.modo === 'B' && estado.congelado),
      compararSensor: estado.ajustes.compararSensor,
      seleccion: estado.seleccion,
      g: window.devicePixelRatio || 1,
      horizonteSensor: hs,
      ancho: Wl,
      alto: Hl,
      margenArriba: 96 * (window.devicePixelRatio || 1),
      margenAbajo: estado.giro === 0 ? 120 * (window.devicePixelRatio || 1) : 0,
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (estado.origen === 'camara' && !estado.congelado && estado.ajustes.vivo && !estado.analizando &&
        t - estado.ultimoAnalisis > 1000 / CONFIG.fpsAnalisis && video.readyState >= 2) {
      analisisVivo();
    }
  }
  if (t - ultimoIndicador > 250) { ultimoIndicador = t; actualizarIndicadores(); }
}

/**
 * Encuadre "Ver fugas": la foto y sus puntos de fuga (hasta 8 anchos de
 * distancia) caben en la pantalla, y se ve cómo continúan las líneas.
 */
function encuadrarFugas() {
  const b = marcoFugas();
  if (!b) return;
  const { x0, y0, x1, y1 } = b;
  const { Wl, Hl } = estado.lienzoLogico || { Wl: lienzo.width, Hl: lienzo.height };
  // dejar sitio a los textos de arriba y a los botones de abajo
  const dpr = window.devicePixelRatio || 1;
  const Hutil = Math.max(100, Hl - 250 * dpr);
  const z = Math.min(1, Math.min(Wl / (x1 - x0), Hutil / (y1 - y0)) / estado.escalaBase);
  estado.vista.zoom = z;
  estado.vista.cx = (x0 + x1) / 2;
  estado.vista.cy = (y0 + y1) / 2 - (40 * dpr) / (estado.escalaBase * z);
}

/**
 * Rectángulo (px de imagen) que contiene la foto y sus puntos de fuga cercanos
 * (hasta CONFIG.distanciaConvergencia anchos), con un margen.
 */
function marcoFugas() {
  const r = estado.resultado;
  if (!r) return null;
  let x0 = 0, y0 = 0, x1 = estado.anchoF, y1 = estado.altoF;
  for (const f of r.familias) {
    const P = f.punto;
    if (Math.abs(P[2]) < 1e-12) continue;
    const x = P[0] / P[2], y = P[1] / P[2];
    if (Math.hypot(x - estado.anchoF / 2, y - estado.altoF / 2) / estado.anchoF > CONFIG.distanciaConvergencia) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const m = 0.08 * Math.max(x1 - x0, y1 - y0);
  return { x0: x0 - m, y0: y0 - m, x1: x1 + m, y1: y1 + m };
}

/** Rectángulo visible en pantalla, en píxeles de imagen (lo que se exporta). */
function marcoVisible() {
  const { Wl, Hl } = estado.lienzoLogico || { Wl: lienzo.width, Hl: lienzo.height };
  const T = estado.T;
  return { x0: -T.ox / T.escala, y0: -T.oy / T.escala, x1: (Wl - T.ox) / T.escala, y1: (Hl - T.oy) / T.escala };
}

/** ¿Se ha cambiado el encuadre por defecto (zoom o desplazamiento)? */
function vistaModificada() {
  const v = estado.vista;
  return Math.abs(v.zoom - 1) > 0.01 ||
    Math.abs(v.cx - estado.anchoF / 2) > 0.5 || Math.abs(v.cy - estado.altoF / 2) > 0.5;
}

function reiniciarVista() {
  estado.vista = { zoom: 1, cx: null, cy: null };
  estado.vistaFugas = false;
}

/** Píxel del lienzo → coordenadas lógicas (deshace el giro de la pantalla). */
function aLogico(p) {
  const W = lienzo.width, H = lienzo.height;
  const { Wl, Hl } = estado.lienzoLogico || { Wl: W, Hl: H };
  const a = (estado.giro * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const x = p[0] - W / 2, y = p[1] - H / 2;
  return [x * c - y * sn + Wl / 2, x * sn + y * c + Hl / 2];
}

/**
 * Los textos de arriba y el mensaje (el "HUD") giran con el móvil, en el espacio
 * que deja libre la barra de botones. Los botones no giran (como en la app Cámara).
 */
function colocarHud() {
  const hud = $('hud');
  const app = $('app').getBoundingClientRect();
  const barra = $('barra').getBoundingClientRect();
  const lateral = estado.giro === 90 || estado.giro === 270;
  hud.classList.toggle('girado', estado.giro !== 0);
  if (!lateral) {
    hud.style.cssText = `width:${app.width}px;height:${app.height}px;left:0;top:0;transform:rotate(${-estado.giro}deg)`;
    return;
  }
  const libreW = app.width, libreH = Math.max(100, barra.top - app.top);
  hud.style.cssText = `width:${libreH}px;height:${libreW}px;left:${(libreW - libreH) / 2}px;top:${(libreH - libreW) / 2}px;transform:rotate(${-estado.giro}deg)`;
}
window.addEventListener('resize', () => colocarHud());

// --- Interfaz -----------------------------------------------------------------
function mostrarApp() {
  $('inicio').hidden = true;
  $('app').hidden = false;
  colocarHud();
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
    const inc = estado.congelado ? estado.inclinacionCongelada : inclinacion(arribaImagen());
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

  // Botón de encuadre (solo con imagen congelada y analizada)
  const bv = $('btn-vista');
  bv.hidden = !(estado.congelado && r && r.familias.length);
  bv.textContent = estado.vista.zoom < 0.98 ? 'Ajustar foto' : 'Ver fugas';

  // Focal (los milisegundos van a Ajustes)
  $('info').textContent = r && r.focalMM ? `Focal ≈ ${formato(r.focalMM, 0)} mm${r.fuenteFocal === 'por defecto' ? ' (supuesta)' : ''}` : '';
  const ms = r && r.tiempos ? Math.round(estado.congelado ? r.tiempos.total : estado.tiempoVivo || r.tiempos.total) : null;
  const comp = r && r.comprobacion ? r.comprobacion : {};
  const partes = [];
  if (comp.horizonteVsSensorGrados != null) partes.push(`horizonte vs. sensor ${formato(comp.horizonteVsSensorGrados)}°`);
  if (comp.ortogonalidadGrados != null) partes.push(`ortogonalidad ±${formato(comp.ortogonalidadGrados)}°`);
  const juicio = partes.length
    ? (Math.max(comp.horizonteVsSensorGrados ?? 0, comp.ortogonalidadGrados ?? 0) < 2 ? ' → coherente' : Math.max(comp.horizonteVsSensorGrados ?? 0, comp.ortogonalidadGrados ?? 0) < 5 ? ' → aceptable' : ' → dudoso')
    : '';
  $('tecnico').textContent = r ? `Análisis: ${ms ?? '—'} ms · ${r.segmentos.length / 4} aristas · focal ${r.fuenteFocal}. Comprobación: ${partes.join(', ') || 'sin datos'}${juicio}` : '';

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
  $('aj-sensor-horizonte').checked = a.compararSensor;
  $('aj-autogiro').checked = a.autoGiro;
  $('aj-original').checked = a.exportarOriginal;
  $('aj-registro').checked = a.exportarRegistro;
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
  if (!estado.imagen || !estado.resultado) { mostrarMensaje('Nada que exportar todavía.'); return; }
  const inc = estado.congelado ? estado.inclinacionCongelada : inclinacion(arribaImagen());
  const r = await exportar(estado.imagen, estado.resultado, {
    modo: estado.ajustes.modo, origen: estado.origen,
    rejilla: estado.ajustes.rejilla, aristas: estado.ajustes.aristas, compararSensor: estado.ajustes.compararSensor,
    incluirOriginal: estado.ajustes.exportarOriginal,
    // si se ha alejado la vista, se exporta lo que se ve (foto + puntos de fuga)
    incluirRegistro: estado.ajustes.exportarRegistro,
    // se exporta EXACTAMENTE lo que se ve: si se ha movido o acercado/alejado la vista, ese encuadre
    marco: estado.congelado && vistaModificada() ? marcoVisible() : null,
    inclinacion: estado.origen === 'camara' ? inc : null,
  });
  if (r === 'descargado') mostrarMensaje('Imagen y registro descargados.');
});

$('btn-vista').addEventListener('click', () => {
  if (estado.vista.zoom < 0.98) reiniciarVista();
  else { encuadrarFugas(); estado.vistaFugas = true; }
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
  a.compararSensor = $('aj-sensor-horizonte').checked;
  a.autoGiro = $('aj-autogiro').checked;
  a.exportarOriginal = $('aj-original').checked;
  a.exportarRegistro = $('aj-registro').checked;
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
  aLogico,
  vista: () => { estado.vistaFugas = estado.vista.zoom < 0.98; return estado.vista; },
  tamLogico: () => estado.lienzoLogico || { Wl: lienzo.width, Hl: lienzo.height },
  escalaBase: () => estado.escalaBase || 1,
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
colocarHud();
requestAnimationFrame(bucle);
