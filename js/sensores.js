// =============================================================================
// sensores.js — inclinación del móvil (DeviceOrientation) → dirección "arriba"
// en coordenadas de la cámara.
//
// El sensor da tres ángulos (alpha, beta, gamma). Solo necesitamos hacia dónde
// cae la gravedad: con ella sabemos dónde está el horizonte y si la cámara está
// inclinada (y, por tanto, si las verticales del edificio deben converger).
//
// Coordenadas del dispositivo (W3C): x a la derecha de la pantalla, y hacia la
// parte superior del móvil, z saliendo de la pantalla hacia el usuario.
// Cámara trasera: x derecha, y hacia ABAJO en la imagen, z hacia delante
// (sale por la espalda del móvil).
// =============================================================================

const RAD = Math.PI / 180;
let ultimo = null;          // { beta, gamma, t }
let estado = 'inactivo';    // 'inactivo' | 'activo' | 'denegado' | 'no-disponible'

function alEvento(e) {
  if (e.beta == null || e.gamma == null) return;
  ultimo = { beta: e.beta, gamma: e.gamma, t: performance.now() };
}

/**
 * Activa los sensores. En iPhone DEBE llamarse dentro de un toque del usuario
 * (requisito de Safari). Devuelve el estado resultante.
 */
export async function activarSensores() {
  if (typeof window.DeviceOrientationEvent === 'undefined') {
    estado = 'no-disponible';
    return estado;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { estado = 'denegado'; return estado; }
    } catch {
      estado = 'denegado';
      return estado;
    }
  }
  window.removeEventListener('deviceorientation', alEvento);
  window.addEventListener('deviceorientation', alEvento);
  estado = 'activo';
  return estado;
}

/** Estado legible. Un ordenador "activa" los sensores pero nunca envía datos. */
export function estadoSensores() {
  if (estado === 'activo' && !datosRecientes()) return 'sin-datos';
  return estado;
}

function datosRecientes() {
  return ultimo && performance.now() - ultimo.t < 1500;
}

function anguloPantalla() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}

/**
 * Vector unitario "hacia arriba" (contrario a la gravedad) en coordenadas de la
 * cámara trasera, teniendo en cuenta el giro de la pantalla. null si no hay datos.
 */
export function arribaCamara() {
  if (!datosRecientes()) return null;
  const b = ultimo.beta * RAD, g = ultimo.gamma * RAD;
  // "arriba" en coordenadas del dispositivo (rotación Z-X'-Y'' de la especificación W3C)
  const ux = -Math.sin(g) * Math.cos(b);
  const uy = Math.sin(b);
  const uz = Math.cos(b) * Math.cos(g);
  // giro de la pantalla (vertical, apaisado…): la imagen gira con ella
  const th = anguloPantalla() * RAD;
  const sx = ux * Math.cos(th) - uy * Math.sin(th);
  const sy = ux * Math.sin(th) + uy * Math.cos(th);
  // pantalla → cámara trasera: y de imagen hacia abajo, z hacia delante
  return [sx, -sy, -uz];
}

/**
 * Inclinación de la cámara respecto a la vertical, en grados:
 *  cabeceo > 0: mira hacia arriba; alabeo: giro de la imagen respecto al horizonte.
 */
export function inclinacion(arriba) {
  if (!arriba) return null;
  const cabeceo = Math.asin(Math.max(-1, Math.min(1, arriba[2]))) / RAD;
  const alabeo = Math.atan2(arriba[0], -arriba[1]) / RAD;
  return { cabeceo, alabeo };
}

// --- Giro de la imagen según cómo se sostiene el móvil ---------------------------
// Con el bloqueo de rotación (habitual en iPhone), la pantalla no gira aunque el
// móvil esté en horizontal: la imagen y los textos quedan de lado. Con la gravedad
// sabemos hacia dónde está "arriba" en la pantalla y giramos nosotros.

/**
 * Ángulo (0, 90, 180 o 270; sentido horario) que hay que girar el fotograma de
 * la cámara para que la escena quede derecha. Mantiene el anterior si el móvil
 * está casi plano o en una posición intermedia (histéresis).
 */
export function giroImagen(anterior = 0) {
  if (!datosRecientes()) return anterior;
  const b = ultimo.beta * RAD, g = ultimo.gamma * RAD;
  const ux = -Math.sin(g) * Math.cos(b), uy = Math.sin(b);
  const th = anguloPantalla() * RAD;
  const sx = ux * Math.cos(th) - uy * Math.sin(th);
  const sy = ux * Math.sin(th) + uy * Math.cos(th);
  if (Math.hypot(sx, sy) < 0.5) return anterior;          // móvil casi plano
  const phi = Math.atan2(sx, sy) / RAD;                   // 0 = arriba de la pantalla; 90 = derecha
  const candidato = ((Math.round(phi / 90) * -90) % 360 + 360) % 360;
  const resto = Math.abs(phi - Math.round(phi / 90) * 90);
  if (candidato !== anterior && resto > 30) return anterior; // zona intermedia
  return candidato;
}

/** Gira un vector de coordenadas de cámara (x, y de imagen) igual que la imagen. */
export function girarVector(v, giro) {
  if (!v || !giro) return v;
  const a = giro * RAD, c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}
