/* Pizarra Criolla · sw.js
   Guarda la app para que abra sin señal, y la última respuesta de cada consulta para mostrar algo mientras vuelve la red.
   Lo que sale de esta copia lleva la hora en que se guardó (x-pizarra-guardado), para que la app no lo muestre como nuevo.
   Los datos en vivo nunca salen del caché si hay red. */
const APP = 'pizarra-app-v3';
const DATA = 'pizarra-datos-v2';
const DATA_MAX = 150;
const SHELL = ['./', 'index.html', 'styles.css?v=3', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/calc.js?v=3', 'js/api.js?v=3', 'js/charts.js?v=3', 'js/core.js?v=3', 'js/juegos.js?v=3', 'js/tabla.js?v=3', 'js/lideres.js?v=3', 'js/equipos.js?v=3', 'js/mas.js?v=3'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== APP && k !== DATA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const sinMarca = url => { const u = new URL(url); u.searchParams.delete('_t'); return u.toString(); };

async function guardar(key, r) {
  const body = await r.blob();
  const headers = new Headers({ 'content-type': r.headers.get('content-type') || 'application/json', 'x-pizarra-guardado': String(Date.now()) });
  const c = await caches.open(DATA);
  await c.put(key, new Response(body, { status: 200, headers }));
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - DATA_MAX))) await c.delete(k);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // La app: primero la red (así llegan los arreglos al instante); sin señal, la copia guardada.
    e.respondWith(fetch(req)
      .then(r => { const copy = r.clone(); caches.open(APP).then(c => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
    return;
  }
  if (url.hostname === 'statsapi.mlb.com') {
    const key = sinMarca(req.url);
    e.respondWith(fetch(req)
      .then(r => {
        if (r.ok && !/feed\/live|linescore|winProbability/.test(url.pathname)) e.waitUntil(guardar(key, r.clone()));
        return r;
      })
      .catch(() => caches.match(key).then(r => r || Response.error())));
  }
});
