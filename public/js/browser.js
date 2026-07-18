// Diamond v3 - URL Encoding/Decoding and Browser Handling

// Encode URL for proxy using base64url encoding (matching server-side)
function encodeUrl(url) {
    if (!url) return url;
    const bytes = new TextEncoder().encode(url);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

// Decode URL from proxy
function decodeUrl(str) {
    if (!str) return str;
    try {
        const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        const binary = atob(base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '='));
        return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
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
