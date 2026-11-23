/*
 * Cross-origin isolation for a static host that cannot send headers, such as GitHub Pages.
 * src/isolation.ts registers this service worker. It adds the headers that vite.config.ts
 * sends in dev to this site's own responses, so the page can start an engine's threads.
 * Another origin's response passes through unchanged: it must allow the page by its own
 * headers, as GitHub's raw files do for the listed books. It caches nothing.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (new URL(request.url).origin !== self.location.origin) return;
  // a request the browser may answer only from its cache, which fetch() would refuse
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  event.respondWith(
    fetch(request).then((response) => {
      // an opaque or redirect response cannot be rebuilt, and needs no header
      if (response.status === 0) return response;
      const headers = new Headers(response.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }),
  );
});
