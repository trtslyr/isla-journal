// Minimal service worker to avoid caching issues while developing
// Always take control immediately and never cache API or dynamic responses

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  try {
    const url = new URL(event.request.url)
    // Never intercept API requests or non-GET
    if (url.pathname.startsWith('/api') || event.request.method !== 'GET') return
    // For now, do not cache; just let the request go to network
    return
  } catch {}
})
