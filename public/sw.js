// Diamond Proxy v3 - Service Worker

const PROXY_PREFIX = '/proxy/~/';

// Encode URL for proxy
function encodeUrl(url) {
    return encodeURIComponent(url).replace(/%/g, '-');
}

// Decode URL from proxy
function decodeUrl(encoded) {
    try {
        let decoded = encoded.replace(/-/g, '%');
        return decodeURIComponent(decoded);
    } catch (e) {
        return encoded;
    }
}

// Build proxy URL
function buildProxyUrl(targetUrl) {
    if (!targetUrl) return '';
    
    if (targetUrl.startsWith('//')) {
        targetUrl = 'https:' + targetUrl;
    } else if (!targetUrl.match(/^https?:\/\//i)) {
        targetUrl = 'https://' + targetUrl;
    }
    
    return PROXY_PREFIX + encodeUrl(targetUrl);
}

self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Activated');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = event.request.url;
    
    // Only handle requests within our scope that need rewriting
    if (!url.includes(self.location.origin)) {
        return;
    }
    
    // Don't intercept proxy requests themselves to avoid loops
    if (url.includes(PROXY_PREFIX)) {
        return;
    }
    
    // Don't intercept static assets
    if (url.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/i)) {
        return;
    }
    
    // For navigation requests, check if we should redirect through proxy
    if (event.request.mode === 'navigate') {
        // Let normal navigation pass through
        return;
    }
    
    // For subresource requests that might be cross-origin
    event.respondWith(
        fetch(event.request).catch(() => {
            // If fetch fails, try through proxy
            const proxiedUrl = buildProxyUrl(url);
            return fetch(proxiedUrl);
        })
    );
});

// Handle messages from main thread
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
