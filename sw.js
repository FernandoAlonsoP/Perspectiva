// =============================================================================
// sw.js — service worker: guarda la app en el móvil tras la primera visita para
// que funcione sin conexión (en el aula o en la calle sin datos).
// Al publicar una versión nueva, cambiar CACHE para que los móviles la descarguen.
// =============================================================================

const CACHE = 'perspectiva-0.4.1';
const ARCHIVOS = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icono.svg', './icono-180.png', './icono-512.png',
  './js/main.js', './js/config.js', './js/camara.js', './js/sensores.js', './js/overlay.js', './js/interaccion.js',
  './js/edicion.js', './js/seguimiento.js', './js/exportar.js', './js/exif.js',
  './js/vision/worker.js', './js/vision/analisis.js', './js/vision/segmentos.js', './js/vision/fuga.js',
  './js/vision/manhattan.js', './js/vision/geometria.js', './js/vision/preparar.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (para recibir mejoras); si no hay conexión, la copia guardada.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
