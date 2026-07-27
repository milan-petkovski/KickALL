// KickALL Service Worker for PWA functionality
const CACHE_NAME = 'kickall-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/css/style.css',
  '/css/dashboard.css',
  '/js/config.js',
  '/js/app.js',
  '/js/dashboard.js',
  '/assets/logo.webp',
  '/assets/favicon.ico',
  '/locales/sr.json',
  '/locales/en.json'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => {
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip ALL external API calls and third-party services
  if (event.request.url.includes('/api/') || 
      event.request.url.includes('/auth/') ||
      event.request.url.includes('supabase') ||
      event.request.url.includes('kick.com') ||
      event.request.url.includes('allorigins.win') ||
      event.request.url.includes('corsproxy.io') ||
      event.request.url.includes('render.com') ||
      event.request.url.includes('onrender.com') ||
      event.request.url.includes('kickbot-') ||
      event.request.url.includes('spotify.com') ||
      event.request.url.includes('accounts.spotify.com')) {
    return;
  }

  // Skip anything that's not from our own domain
  const url = new URL(event.request.url);
  if (!url.hostname.includes('localhost') && 
      !url.hostname.includes('kickall.app') &&
      !url.hostname.includes('netlify.app')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Return cached version if available
        if (cachedResponse) {
          return cachedResponse;
        }

        // Otherwise fetch from network
        return fetch(event.request)
          .then((response) => {
            // Don't cache if not successful
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone response to cache
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              })
              .catch(err => {
                // Silently fail cache errors
              });

            return response;
          })
          .catch((error) => {
            // Return offline fallback for HTML pages
            if (event.request.headers.get('accept') && 
                event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/index.html');
            }
            // Return offline fallback for CSS/JS
            if (event.request.url.endsWith('.css') || 
                event.request.url.endsWith('.js')) {
              return new Response('Offline - Resource not available', {
                status: 503,
                headers: { 'Content-Type': 'text/plain' }
              });
            }
          });
      })
      .catch((error) => {
        return fetch(event.request);
      })
  );
});

// Handle background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(syncData());
  }
});

// Handle push notifications
self.addEventListener('push', (event) => {
  const options = {
    body: event.data ? event.data.text() : 'Nova notifikacija od KickALL',
    icon: '/assets/logo.webp',
    badge: '/assets/logo.webp',
    vibrate: [200, 100, 200],
    data: {
      url: '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification('KickALL', options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/')
  );
});

async function syncData() {
  // Implement data synchronization logic here
  // This would sync any offline actions when connection is restored
}
