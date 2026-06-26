// Service worker: cachea el "shell" para que la app cargue sin conexion.
// Las llamadas al API NO se cachean (van siempre a red); los fichajes offline
// se gestionan con la cola en localStorage (ver fichar.js).
const CACHE = 'fichaje-mn-v3';
const SHELL = [
  '/', '/index.html',
  '/css/styles.css', '/js/app.js', '/js/common.js', '/js/fichar.js', '/js/mis-fichajes.js', '/js/admin.js',
  '/manifest.json', '/img/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;          // no cachear POST de fichaje
  if (url.pathname.startsWith('/api/')) return;     // API siempre a red
  // Network-first: siempre la version fresca con internet; cache solo de respaldo
  // (offline). Asi no se sirven versiones antiguas y el modo offline sigue activo.
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('/index.html')))
  );
});
