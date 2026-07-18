/* Diamond service worker with Scramjet-first boot and local fallback. */
const DIAMOND_PROXY_PREFIX = '/proxy~/';
const LEGACY_PROXY_PREFIX = '/proxy/~/';

try {
  importScripts('/scramjet/scramjet.all.js');
  const scramjet = new self.ScramjetServiceWorker();
  scramjet.route(({ url }) => url.pathname.startsWith(DIAMOND_PROXY_PREFIX));
  self.__diamondScramjet = scramjet;
} catch (error) {
  console.warn('[Diamond] Scramjet bundle unavailable, using streaming fallback:', error.message);
}

function encodeUrl(url) {
  const bytes = new TextEncoder().encode(url);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeTarget(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function fallbackProxyUrl(url) {
  return `${LEGACY_PROXY_PREFIX}${encodeUrl(normalizeTarget(url))}`;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (self.__diamondScramjet) return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/proxy/')) return;
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => fetch(fallbackProxyUrl(event.request.url))));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
