// =====================================================================
// CIMED · Gestão de Projetos — service worker
//
// Guarda só a casca do site (HTML, CSS, JS, ícones) para o app abrir
// rápido e não ficar em branco quando a conexão oscila.
//
// DADO DE PROJETO NUNCA É GUARDADO AQUI. Toda chamada ao Supabase passa
// direto pela rede: sem internet o app abre e diz que não conectou, em
// vez de mostrar um número velho como se fosse o de agora.
// =====================================================================

const VERSAO = 'cimed-projetos-v12';

const CASCA = [
  './',
  './index.html',
  './style.css?v=12',
  './app.js?v=12',
  './config.js',
  './favicon.svg',
  './icone-192.png',
  './icone-512.png',
  './manifest.json?v=12',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSAO)
      .then((c) => c.addAll(CASCA).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Supabase, CDN e qualquer coisa que não seja deste site: sempre rede.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Rede primeiro, cache como rede de segurança. Assim uma publicação
  // nova chega na hora e o app continua abrindo se a rede cair.
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
