// Limpeza: o App do posto chegou a ser publicado na raiz do site e deixou um
// service worker aqui. Este arquivo desliga esse worker nos navegadores de quem
// visitou, para o site institucional voltar a aparecer. O App continua em /app/.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await self.registration.unregister();
    const cs = await self.clients.matchAll({ type: 'window' });
    cs.forEach(c => c.navigate(c.url));
  })());
});
