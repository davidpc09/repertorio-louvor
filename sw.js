// Service worker: guarda o app no aparelho para abrir sem internet.
// Ao publicar uma versão nova, aumente VERSION para os aparelhos atualizarem.
const VERSION = 'repertorio-v0.5.0';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/config.js',
  './js/cloud/client.js',
  './js/cloud/sync.js',
  './js/cloud/drive.js',
  './js/cloud/tracksync.js',
  './js/nav.js',
  './js/dom.js',
  './js/icons.js',
  './js/store.js',
  './js/music.js',
  './js/calendar.js',
  './js/views/agenda.js',
  './js/importer.js',
  './js/audio/engine.js',
  './js/audio/analysis.js',
  './js/audio/cues.js',
  './js/audio/trackstore.js',
  './js/views/login.js',
  './js/views/home.js',
  './js/views/songs.js',
  './js/views/setlists.js',
  './js/views/import.js',
  './js/views/reports.js',
  './js/views/team.js',
  './js/views/more.js',
  './js/views/player.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Arquivos do app: usa o que está guardado e atualiza em segundo plano.
// Fontes do Google: guardadas na primeira vez que carregam.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: sameOrigin });
    const network = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    const res = await network;
    if (res) return res;
    if (req.mode === 'navigate') return cache.match('./index.html');
    return new Response('', { status: 504 });
  }));
});
