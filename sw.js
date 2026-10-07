/* Pizarra Criolla · sw.js
   Abre la app al instante: la app (shell) sale de la copia guardada y se revisa en segundo plano. Cada versión trae su
   lista; una versión nueva queda esperando hasta que la persona toque "Actualizar" (la página manda 'actualizar').
   Las fuentes de Google se guardan la primera vez y desde ahí salen de la copia.
   Datos: primero la red; sin señal, la última respuesta guardada, que lleva la hora en que se guardó (x-pizarra-guardado)
   para que la app no la muestre como nueva. Los datos en vivo nunca salen del caché si hay red.
   AL PUBLICAR: subir VERSION aquí y el ?v= de todos los archivos en index.html (los dos al mismo número); un archivo
   nuevo va también en SHELL. Sin eso, la gente se queda con la versión vieja: los archivos con ?v= se sirven de la
   copia sin preguntar a la red. Todos los pasos: README.md, "Publicar una versión nueva". */
const VERSION = '6';
const APP = 'pizarra-app-v' + VERSION;
const DATA = 'pizarra-datos-v2';
const FONTS = 'pizarra-fuentes-v1';
const DATA_MAX = 150, FONTS_MAX = 30;
const Q = '?v=' + VERSION; // los mismos nombres que pide index.html
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png',
  'styles.css' + Q, 'css/juegos.css' + Q, 'css/graficos.css' + Q, 'css/fichas.css' + Q, 'css/tablas.css' + Q, 'css/nav.css' + Q, 'css/app.css' + Q, 'css/tv.css' + Q,
  'js/calc.js' + Q, 'js/api.js' + Q, 'js/charts.js' + Q, 'js/core.js' + Q, 'js/juegos.js' + Q, 'js/juego.js' + Q, 'js/tabla.js' + Q,
  'js/lideres.js' + Q, 'js/equipos.js' + Q, 'js/mas.js' + Q, 'js/buscar.js' + Q, 'js/comparar.js' + Q];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    // Los archivos con ?v= no cambian nunca: si la página los acaba de bajar, salen de la copia HTTP del navegador y no
    // se bajan dos veces en la primera visita. Lo que no lleva ?v= (la página, el manifest, el ícono) se revalida.
    await c.addAll(SHELL.map(u => new Request(u, { cache: /[?&]v=/.test(u) ? 'force-cache' : 'no-cache' })));
    // Primera instalación: se activa directo. Si ya hay una versión funcionando, espera a que la persona decida.
    // Excepción: las versiones 2 y 3 iban primero a la red, así que la página ya corre el código nuevo: no hay nada que ofrecer.
    const vieja = (await caches.has('pizarra-app-v2')) || (await caches.has('pizarra-app-v3'));
    if (!self.registration.active || vieja) await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Solo se borran copias de esta app: el dominio de GitHub Pages puede tener otras.
    const keep = [APP, DATA, FONTS];
    for (const k of await caches.keys()) if (/^pizarra-/.test(k) && keep.indexOf(k) < 0) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'actualizar') self.skipWaiting();
});

const sinMarca = url => { const u = new URL(url); u.searchParams.delete('_t'); return u.toString(); };

async function recortar(c, max) {
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k);
}

async function guardar(key, r) {
  const body = await r.blob();
  const headers = new Headers({ 'content-type': r.headers.get('content-type') || 'application/json', 'x-pizarra-guardado': String(Date.now()) });
  const c = await caches.open(DATA);
  await c.put(key, new Response(body, { status: 200, headers }));
  await recortar(c, DATA_MAX);
}

// Guarda en la copia de ESTA versión lo que llegó de la red. La página solo si es la de esta versión (pide sus ?v=):
// el index de una versión nueva lo guarda el service worker nuevo al instalarse; si lo guardara este, la próxima
// apertura pediría archivos ?v= que esta copia no tiene (y sin señal la app no arrancaría).
async function guardarApp(c, key, r, page) {
  if (!page) return c.put(key, r);
  const txt = await r.text();
  if (txt.indexOf('?v=' + VERSION) < 0) return;
  await c.put(key, new Response(txt, { status: r.status, statusText: r.statusText, headers: r.headers }));
}

// La app: lo guardado primero y la red en segundo plano (stale-while-revalidate). La página se busca sin su "?…".
// Los archivos con ?v= no cambian nunca (cada publicación sube el número): si están guardados, no se vuelven a pedir.
async function app(e, req, url) {
  const c = await caches.open(APP);
  const page = req.mode === 'navigate';
  const key = page ? url.origin + url.pathname : req;
  // red de seguridad: lo que no esté en la copia de esta versión puede estar en otra (la nueva que espera, por ejemplo)
  const hit = (await c.match(key)) || (page ? (await c.match('./')) || (await c.match('index.html')) : null) || (await caches.match(req));
  if (hit && !page && url.searchParams.has('v')) return hit;
  const red = fetch(req).then(r => {
    if (r.ok && r.type === 'basic') e.waitUntil(guardarApp(c, key, r.clone(), page).catch(() => { /* sin espacio */ }));
    return r;
  });
  if (hit) { e.waitUntil(red.catch(() => { /* sin señal: queda la copia */ })); return hit; }
  return red.catch(() => Response.error());
}

// Fuentes de Google: la copia primero; si no hay, la red y se guarda.
async function fuente(e, req) {
  const c = await caches.open(FONTS);
  const hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  // Solo respuestas legibles (CORS): una opaca ocupa muchísimo espacio de la cuota.
  if (r.ok) { const copy = r.clone(); e.waitUntil(c.put(req, copy).then(() => recortar(c, FONTS_MAX))); }
  return r;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(app(e, req, url));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(fuente(e, req));
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
