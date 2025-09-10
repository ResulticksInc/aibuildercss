const CACHE_NAME = 'smartdx-v2.1.0';
const STATIC_CACHE = 'smartdx-static-v2.1.0';
const DYNAMIC_CACHE = 'smartdx-dynamic-v2.1.0';
const API_CACHE = 'smartdx-api-v2.1.0';

// Assets to cache immediately
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/favicon.png',
  '/favicon/android-chrome-192x192.png',
  '/favicon/android-chrome-512x512.png',
  '/manifest.webmanifest'
];

// API endpoints to cache
const API_ENDPOINTS = [
  '/api/',
  'https://apig.smartdx.co/',
  'https://apigd.smartdx.co/',
  'https://sdkmg.smartdx.co/',
  'https://sdkma.smartdx.co/'
];

// Assets to cache on first access
const CACHE_ON_DEMAND = [
  /\.(?:js|css|woff2?|png|jpg|jpeg|svg|gif|webp)$/,
  /\/assets\//,
  /\/static\//
];

// Maximum cache size (in items)
const MAX_CACHE_SIZE = 150;
const MAX_API_CACHE_SIZE = 50;

self.addEventListener('install', event => {
  console.log('SW: Installing Service Worker...');
  
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(STATIC_CACHE).then(cache => {
        console.log('SW: Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      }),
      
      // Skip waiting to activate immediately
      self.skipWaiting()
    ])
  );
});

self.addEventListener('activate', event => {
  console.log('SW: Activating Service Worker...');
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== STATIC_CACHE && 
                cacheName !== DYNAMIC_CACHE && 
                cacheName !== API_CACHE) {
              console.log('SW: Removing old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      
      // Take control of all pages immediately
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension and other non-http(s) requests
  if (!request.url.startsWith('http')) {
    return;
  }

  // Handle different types of requests
  if (isStaticAsset(request)) {
    event.respondWith(handleStaticAsset(request));
  } else if (isAPIRequest(request)) {
    event.respondWith(handleAPIRequest(request));
  } else if (isDynamicAsset(request)) {
    event.respondWith(handleDynamicAsset(request));
  } else if (isNavigationRequest(request)) {
    event.respondWith(handleNavigationRequest(request));
  }
});

// Handle static assets (CSS, JS, images, fonts)
async function handleStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  
  if (cached) {
    // Return cached version immediately
    return cached;
  }
  
  try {
    // Fetch and cache the asset
    const response = await fetch(request);
    if (response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('SW: Failed to fetch static asset:', request.url);
    // Return a fallback if needed
    return new Response('Asset not available', { status: 404 });
  }
}

// Handle API requests with stale-while-revalidate strategy
async function handleAPIRequest(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);
  
  // Always try to fetch fresh data
  const fetchPromise = fetch(request)
    .then(response => {
      if (response.status === 200) {
        cache.put(request, response.clone());
        limitCacheSize(API_CACHE, MAX_API_CACHE_SIZE);
      }
      return response;
    })
    .catch(error => {
      console.log('SW: API request failed:', request.url);
      return cached || new Response('API not available', { status: 503 });
    });
  
  // Return cached data immediately if available
  return cached || fetchPromise;
}

// Handle dynamic assets with cache-first strategy
async function handleDynamicAsset(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);
  
  if (cached) {
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.status === 200) {
      cache.put(request, response.clone());
      limitCacheSize(DYNAMIC_CACHE, MAX_CACHE_SIZE);
    }
    return response;
  } catch (error) {
    console.log('SW: Failed to fetch dynamic asset:', request.url);
    return new Response('Resource not available', { status: 404 });
  }
}

// Handle navigation requests (HTML pages)
async function handleNavigationRequest(request) {
  try {
    // Always try network first for navigation
    const response = await fetch(request);
    
    // Cache successful responses
    if (response.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    // Fallback to cached version or app shell
    const cache = await caches.open(STATIC_CACHE);
    const cachedResponse = await cache.match('/index.html');
    return cachedResponse || new Response('App not available offline', { status: 503 });
  }
}

// Helper functions
function isStaticAsset(request) {
  const url = new URL(request.url);
  return CACHE_ON_DEMAND.some(pattern => {
    if (pattern instanceof RegExp) {
      return pattern.test(url.pathname);
    }
    return url.pathname.includes(pattern);
  });
}

function isAPIRequest(request) {
  const url = request.url;
  return API_ENDPOINTS.some(endpoint => url.includes(endpoint));
}

function isDynamicAsset(request) {
  const url = new URL(request.url);
  return url.pathname.includes('/assets/') || 
         url.pathname.includes('/static/') ||
         url.pathname.endsWith('.json');
}

function isNavigationRequest(request) {
  return request.mode === 'navigate' || 
         (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

// Limit cache size to prevent storage bloat
async function limitCacheSize(cacheName, maxSize) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxSize) {
    // Delete oldest entries (FIFO)
    const keysToDelete = keys.slice(0, keys.length - maxSize);
    await Promise.all(keysToDelete.map(key => cache.delete(key)));
  }
}

// Background sync for failed requests (if supported)
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    event.waitUntil(handleBackgroundSync());
  }
});

async function handleBackgroundSync() {
  console.log('SW: Performing background sync...');
  // Implement background sync logic here
  // e.g., retry failed API requests
}

// Handle push notifications (if needed)
self.addEventListener('push', event => {
  if (event.data) {
    const options = {
      body: event.data.text(),
      icon: '/favicon/android-chrome-192x192.png',
      badge: '/favicon/android-chrome-192x192.png',
      vibrate: [100, 50, 100],
      data: {
        dateOfArrival: Date.now(),
        primaryKey: '1'
      },
      actions: [
        {
          action: 'explore',
          title: 'Open SmartDX',
          icon: '/favicon/android-chrome-192x192.png'
        },
        {
          action: 'close',
          title: 'Close',
          icon: '/favicon/android-chrome-192x192.png'
        }
      ]
    };
    
    event.waitUntil(
      self.registration.showNotification('SmartDX', options)
    );
  }
});

// Message handling for cache updates
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data && event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(DYNAMIC_CACHE).then(cache => {
        return cache.addAll(event.data.payload);
      })
    );
  }
});

console.log('SW: Service Worker registered successfully');