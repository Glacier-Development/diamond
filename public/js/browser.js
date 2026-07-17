// Diamond Proxy v3 - URL Encoding/Decoding and Browser Handling

// Encode URL for proxy using base64url encoding (matching server-side)
function encodeUrl(url) {
    if (!url) return url;
    return Buffer.from(url, 'utf-8').toString('base64url');
}

// Decode URL from proxy
function decodeUrl(str) {
    if (!str) return str;
    try {
        return Buffer.from(str, 'base64url').toString('utf-8');
    } catch (e) {
        // Fallback to legacy format
        try {
            let decoded = str.replace(/-/g, '%');
            return decodeURIComponent(decoded);
        } catch (e2) {
            return str;
        }
    }
}

// Get the proxy prefix from environment or default
const PROXY_PREFIX = '/proxy/~/';

// Check if current page is running in proxy
function isInProxy() {
    return window.location.pathname.startsWith('/proxy/~/');
}

// Get the target URL from current location
function getTargetUrl() {
    const path = window.location.pathname;
    if (!path.startsWith(PROXY_PREFIX)) {
        return null;
    }
    
    const encoded = path.substring(PROXY_PREFIX.length);
    return decodeUrl(encoded);
}

// Build proxy URL for a target
function buildProxyUrl(targetUrl) {
    if (!targetUrl) return '';
    
    // Already proxied
    if (targetUrl.startsWith('/proxy/~/')) return targetUrl;
    
    // Skip special protocols
    const skipProtocols = ['data:', 'javascript:', 'mailto:', 'tel:', 'blob:', '#'];
    for (const protocol of skipProtocols) {
        if (targetUrl.startsWith(protocol)) return targetUrl;
    }
    
    // Handle protocol-relative URLs
    if (targetUrl.startsWith('//')) {
        targetUrl = window.location.protocol + targetUrl;
    } else if (!targetUrl.match(/^https?:\/\//i)) {
        // Relative URL - resolve against current target
        const base = getTargetUrl();
        if (base) {
            try {
                targetUrl = new URL(targetUrl, base).href;
            } catch (e) {
                targetUrl = 'https://' + targetUrl;
            }
        } else {
            targetUrl = 'https://' + targetUrl;
        }
    }
    
    // Validate URL
    try {
        new URL(targetUrl);
    } catch (e) {
        return targetUrl;
    }
    
    return PROXY_PREFIX + encodeUrl(targetUrl);
}

// Register service worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(registration => {
                console.log('[SW] Service Worker registered:', registration.scope);
            })
            .catch(error => {
                console.error('[SW] Registration failed:', error);
            });
        
        // Listen for messages from service worker
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'PROXY_NAVIGATE') {
                // Navigate to proxied URL
                window.location.href = buildProxyUrl(event.data.url);
            }
        });
    });
}

// Monkeypatch browser APIs when running inside proxy frame
(function() {
    // Only run in iframe context
    if (window === top) return;
    
    const originalFetch = window.fetch;
    const originalXHR = window.XMLHttpRequest;
    const originalOpen = window.open;
    
    // Intercept fetch - properly handle both string and Request objects
    window.fetch = function(...args) {
        let url = args[0];
        
        if (typeof url === 'string') {
            // Skip data URLs and already proxied URLs
            if (!url.startsWith('data:') && !url.startsWith('/proxy/~/')) {
                const proxiedUrl = buildProxyUrl(url);
                args[0] = proxiedUrl;
            }
        } else if (url instanceof Request) {
            const newUrl = buildProxyUrl(url.url);
            args[0] = new Request(newUrl, {
                method: url.method,
                headers: url.headers,
                body: url.body,
                mode: url.mode,
                credentials: url.credentials,
                cache: url.cache,
                redirect: url.redirect,
                referrer: url.referrer,
                integrity: url.integrity
            });
        }
        
        return originalFetch.apply(this, args);
    };
    
    // Intercept XMLHttpRequest
    window.XMLHttpRequest = function() {
        const xhr = new originalXHR();
        const originalOpenXhr = xhr.open;
        
        xhr.open = function(method, url, ...rest) {
            if (typeof url === 'string' && !url.startsWith('data:') && !url.startsWith('/proxy/~/')) {
                url = buildProxyUrl(url);
            }
            return originalOpenXhr.call(this, method, url, ...rest);
        };
        
        return xhr;
    };
    
    // Intercept window.open
    window.open = function(url, ...args) {
        if (url && !url.startsWith('data:') && !url.startsWith('/proxy/~/')) {
            url = buildProxyUrl(url);
        }
        return originalOpen.call(this, url, ...args);
    };
    
    // Intercept link clicks - prevent character corruption
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (link && link.href) {
            const href = link.getAttribute('href');
            
            // Don't interfere with special protocols
            if (href.startsWith('javascript:') || 
                href.startsWith('mailto:') || 
                href.startsWith('tel:') ||
                href.startsWith('#') ||
                href.startsWith('data:')) {
                return;
            }
            
            // Rewrite href to go through proxy
            const proxiedHref = buildProxyUrl(href);
            link.setAttribute('href', proxiedHref);
        }
    }, true);
    
    // Intercept form submissions
    document.addEventListener('submit', (e) => {
        const form = e.target;
        if (form && form.action) {
            const action = form.getAttribute('action');
            if (action && !action.startsWith('data:')) {
                form.setAttribute('action', buildProxyUrl(action));
            }
        }
    }, true);
    
    console.log('[Diamond] Proxy monkeypatches applied');
})();
