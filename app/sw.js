// C&S — service worker: guarda as telas do app para abrir mesmo sem internet.
// Só cuida de arquivos do próprio site; os dados (Supabase) passam direto.
const CACHE = 'cs-v5';
const ARQUIVOS = ['./', './index.html', './painel.html', './treinamento.html', './dados.js', './config.js', './vendor/supabase.js',
  './manifest-posto.json', './manifest-painel.json', './icons/logo.png', './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // Supabase e fontes: direto pela rede
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
