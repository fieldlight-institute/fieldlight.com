// Only the public editor shell is cached. Posts, credentials, and publishing requests never enter this cache.
const CACHE_NAME = 'fieldlight-post-shell-v2';
const SHELL = ['/post/', '/post/index.html', '/post/post.css', '/post/composer.js', '/post/publisher.js', '/post/connection.js', '/post/manifest.webmanifest', '/styles.css?v=38', '/assets/fieldlight-burst-touch.png', '/assets/fieldlight-burst-48.png'];
const SHELL_URLS = new Set(SHELL.map(path => new URL(path, self.location.origin).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await Promise.all(SHELL.map(async path => {
      const request = new Request(path, { credentials: 'omit', cache: 'reload' });
      const response = await fetch(request);
      if (response.ok && !response.headers.has('set-cookie')) await cache.put(path, response);
    }));
    await self.skipWaiting();
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('fieldlight-post-shell-') && name !== CACHE_NAME).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !SHELL_URLS.has(request.url)) return;
  event.respondWith(fetch(new Request(request, { credentials: 'omit', cache: 'no-cache' })).then(async response => {
    if (response.ok && !response.headers.has('set-cookie')) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request.url, response.clone());
    }
    return response;
  }).catch(async () => (await caches.match(request.url)) || Response.error()));
});
