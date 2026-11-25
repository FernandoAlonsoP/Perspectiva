// =============================================================================
// camara.js — acceso a la cámara trasera del móvil.
// =============================================================================

let flujo = null;

/** Arranca la cámara trasera en el <video>. Lanza Error con mensaje en español. */
export async function iniciarCamara(video) {
  if (!window.isSecureContext) {
    throw new Error('La cámara solo funciona en una dirección segura (https://). Abre la app desde su enlace oficial.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite usar la cámara. Prueba con Safari (iPhone) o Chrome (Android) actualizados.');
  }
  detenerCamara();
  try {
    flujo = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });
  } catch (e) {
    const mensajes = {
      NotAllowedError: 'Permiso de cámara denegado. Actívalo en los ajustes del navegador o usa «Foto».',
      SecurityError: 'Permiso de cámara denegado. Actívalo en los ajustes del navegador o usa «Foto».',
      NotFoundError: 'No se ha encontrado ninguna cámara. Puedes usar «Foto».',
      OverconstrainedError: 'La cámara no admite la configuración pedida. Puedes usar «Foto».',
      NotReadableError: 'La cámara está ocupada por otra app. Ciérrala y vuelve a intentarlo.',
    };
    throw new Error(mensajes[e.name] || `No se pudo abrir la cámara (${e.name || e}).`);
  }
  video.srcObject = flujo;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  // esperar a conocer el tamaño real del vídeo
  if (!video.videoWidth) await new Promise((ok) => video.addEventListener('loadedmetadata', ok, { once: true }));
  return describirCamara();
}

export function detenerCamara() {
  if (flujo) flujo.getTracks().forEach((t) => t.stop());
  flujo = null;
}

export function camaraActiva() { return !!flujo; }

/** Datos de la pista de vídeo (para el registro de exportación). */
function describirCamara() {
  const pista = flujo?.getVideoTracks()[0];
  const ajustes = pista?.getSettings?.() || {};
  return { etiqueta: pista?.label || '', ancho: ajustes.width, alto: ajustes.height, facingMode: ajustes.facingMode || '' };
}
