/* ============================================================
   sw.js — Service worker cache-first mínimo (app shell)
   ============================================================ */

const CACHE_NAME = 'editor-musical-v1';

const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/constants.js',
  './js/music.js',
  './js/state.js',
  './js/renderer.js',
  './js/audio.js',
  './js/midi.js',
  './js/ui.js',
  './js/serial.js',
  './js/demo.js',
  './js/codegen/common.js',
  './js/codegen/registry.js',
  './js/codegen/templates/arduino-uno.js',
  './js/codegen/templates/atmega328p.js',
  './js/codegen/templates/esp32.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return res;
      });
    })
  );
});
