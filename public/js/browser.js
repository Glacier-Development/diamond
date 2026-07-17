// Diamond Proxy v3 - URL Encoding/Decoding

// Encode URL for proxy (encodeURIComponent with % replaced by -)
function encodeUrl(url) {
    return encodeURIComponent(url).replace(/%/g, '-');
}

// Decode URL from proxy (replace - with % then decodeURIComponent)
function decodeUrl(encoded) {
    try {
        // First try direct replacement
        let decoded = encoded.replace(/-/g, '%');
        return decodeURIComponent(decoded);
    } catch (e) {
        // If that fails, try multiple decoding passes
        let result = encoded;
        for (let i = 0; i < 3; i++) {
            try {
                result = result.replace(/-/g, '%');
                return decodeURIComponent(result);
            } catch (e) {
                // Try without replacing if already decoded
                try {
                    return decodeURIComponent(encoded);
                } catch (e2) {
                    // Return as-is if all fails
                    return encoded;
                }
            }
        }
        return encoded;
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
    const originalLocation = Object.getOwnPropertyDescriptor(Window.prototype, 'location');
    
    // Intercept fetch
    window.fetch = function(...args) {
        let url = args[0];
        
        if (typeof url === 'string') {
            url = buildProxyUrl(url);
            args[0] = url;
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
            if (typeof url === 'string') {
                url = buildProxyUrl(url);
            }
            return originalOpenXhr.call(this, method, url, ...rest);
        };
        
        return xhr;
    };
    
    // Intercept window.open
    window.open = function(url, ...args) {
        if (url) {
            url = buildProxyUrl(url);
        }
        return originalOpen.call(this, url, ...args);
    };
    
    // Intercept link clicks
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (link && link.href) {
            // Don't interfere with special protocols
            if (link.href.startsWith('javascript:') || 
                link.href.startsWith('mailto:') || 
                link.href.startsWith('tel:')) {
                return;
            }
            
            // Rewrite href to go through proxy
            link.href = buildProxyUrl(link.getAttribute('href'));
        }
    }, true);
    
    // Intercept form submissions
    document.addEventListener('submit', (e) => {
        const form = e.target;
        if (form && form.action) {
            form.action = buildProxyUrl(form.getAttribute('action'));
        }
    }, true);
    
    console.log('[Diamond] Proxy monkeypatches applied');
})();
