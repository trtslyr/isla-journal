const CACHE_NAME = 'isla-cache-v1'
const ASSETS = [
  './',
  '/index.html',
  '/icon.svg'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  try {
    const url = new URL(event.request.url)
    // Do not cache Ollama API calls
    if (url.hostname === '127.0.0.1' && url.port === '11434') return
    if (event.request.method !== 'GET') return
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((resp) => {
        const copy = resp.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {})
        return resp
      }).catch(() => cached))
    )
  } catch {}
})