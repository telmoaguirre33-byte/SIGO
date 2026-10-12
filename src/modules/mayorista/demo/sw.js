// Alcance exclusivo de esta demo: nunca registrar desde el origen principal de SIGO.
const CACHE = 'sigo-mayorista-demo-shell-v5';
const ASSETS = ['./','./index.html','./offline-check.html','./offline-check.mjs','./admin.html','./admin.mjs','./admin/model.mjs','./admin/state.mjs','./app.mjs','./styles.css','./storage.mjs','./sample.mjs','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest','./offline/pedidos-indexeddb.js','./offline/pedidos-locales.js','./offline/catalogo-indexeddb.js','./sync/validacion-pedidos.js','./sync/contrato-pedidos.js'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('sigo-mayorista-demo-shell-') && name!==CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET')return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope))return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE);const hit=await cache.match(event.request,{ignoreSearch:false});if(hit)return hit;try{return await fetch(event.request);}catch(error){if(event.request.mode==='navigate')return cache.match('./index.html');throw error;}})());
});
