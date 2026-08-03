// KickALL Service Worker for PWA functionality
const CACHE_NAME = 'kickall-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/pricing.html',
  '/refund.html',
  '/privacy.html',
  '/terms.html',
  '/css/base.css',
  '/css/style.css',
  '/css/dashboard.css',
  '/js/config.js',
  '/js/app.js',
  '/js/dashboard.js',
  '/js/mobile-optimization.js',
  '/js/toast.js',
  '/js/data-layer.js',
  '/js/route-tracking.js',
  '/js/consent-banner.js',
  '/js/analytics.js',
  '/assets/logo.webp',
  '/assets/kickall.webp',
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

// Fetch event - network-first for HTML, cache-first for static assets
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
    event.request.url.includes('youtube.com') ||
    event.request.url.includes('googlevideo.com')) {
    return;
  }

  // Skip anything that's not from our own domain
  const url = new URL(event.request.url);
  if (!url.hostname.includes('localhost') &&
    !url.hostname.includes('kickall.app') &&
    !url.hostname.includes('netlify.app')) {
    return;
  }

  // Check if this is an HTML file
  const isHtmlRequest = event.request.headers.get('accept') &&
    event.request.headers.get('accept').includes('text/html');

  if (isHtmlRequest) {
    // Network-first strategy for HTML files
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the fresh response
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              })
              .catch(err => {
                // Silently fail cache errors
              });
          }
          return response;
        })
        .catch((error) => {
          // Fallback to cache if network fails
          return caches.match(event.request)
            .then((cachedResponse) => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // Ultimate fallback to index.html
              return caches.match('/index.html');
            });
        })
    );
  } else {
    // Cache-first strategy for static assets (CSS, JS, images)
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            // Try to update cache in background
            fetch(event.request)
              .then((response) => {
                if (response && response.status === 200) {
                  const responseToCache = response.clone();
                  caches.open(CACHE_NAME)
                    .then((cache) => {
                      cache.put(event.request, responseToCache);
                    })
                    .catch(err => {
                      // Silently fail cache errors
                    });
                }
              })
              .catch(() => {
                // Ignore network errors, serve cached version
              });
            return cachedResponse;
          }

          // Not in cache, fetch from network
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
  }
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
