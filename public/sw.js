/**
 * Diamond Service Worker - Interception Engine
 * 
 * Intercepts all network requests and routes them through the proxy.
 * Handles HTML rewriting, CSS/JS injection, WebSocket proxying, and more.
 * 
 * Optimized for low-end hardware with minimal overhead.
 */

const PROXY_PREFIX = '/proxy/';
const SW_VERSION = '1.0.0';

// Base64url encoding/decoding (same as backend)
function encodeUrl(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function decodeUrl(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return decodeURIComponent(escape(atob(str)));
}

/**
 * Rewrites URLs in HTML content to use the proxy
 */
function rewriteHtml(html, baseUrl) {
  if (!html || typeof html !== 'string') return html;
  
  try {
    const url = new URL(baseUrl);
    const origin = url.origin;
    
    // Rewrite common URL attributes
    const attrPatterns = [
      /(href\s*=\s*["'])([^"']+)(["'])/gi,
      /(src\s*=\s*["'])([^"']+)(["'])/gi,
      /(action\s*=\s*=\s*["'])([^"']+)(["'])/gi,
      /(data-src\s*=\s*["'])([^"']+)(["'])/gi,
      /(poster\s*=\s*["'])([^"']+)(["'])/gi,
    ];
    
    let result = html;
    
    // Simple URL rewriting (production would use a proper HTML parser)
    result = result.replace(/(href|src|action|data-src|poster)\s*=\s*(["'])([^"']+)(\2)/gi, (match, attr, quote, value) => {
      // Skip data URLs, javascript:, mailto:, tel:, etc.
      if (value.startsWith('data:') || 
          value.startsWith('javascript:') || 
          value.startsWith('mailto:') || 
          value.startsWith('tel:') ||
          value.startsWith('#') ||
          value.startsWith('blob:')) {
        return match;
      }
      
      // Handle relative URLs
      let absoluteUrl;
      if (value.startsWith('//')) {
        absoluteUrl = url.protocol + value;
      } else if (value.startsWith('/')) {
        absoluteUrl = origin + value;
      } else if (value.startsWith('http://') || value.startsWith('https://')) {
        absoluteUrl = value;
      } else {
        // Relative to current path
        const basePath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
        absoluteUrl = origin + basePath + value;
      }
      
      const proxiedPath = PROXY_PREFIX + encodeUrl(absoluteUrl);
      return `${attr}=${quote}${proxiedPath}${quote}`;
    });
    
    // Rewrite srcset attributes (for responsive images)
    result = result.replace(/srcset\s*=\s*(["'])([^"']+)(\1)/gi, (match, quote, value) => {
      const rewritten = value.split(',').map(part => {
        const [urlPart, descriptor] = part.trim().split(/\s+/);
        if (!urlPart || urlPart.startsWith('data:')) return part;
        
        let absoluteUrl;
        if (urlPart.startsWith('//')) {
          absoluteUrl = url.protocol + urlPart;
        } else if (urlPart.startsWith('/')) {
          absoluteUrl = origin + urlPart;
        } else if (urlPart.startsWith('http://') || urlPart.startsWith('https://')) {
          absoluteUrl = urlPart;
        } else {
          const basePath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
          absoluteUrl = origin + basePath + urlPart;
        }
        
        const proxiedPath = PROXY_PREFIX + encodeUrl(absoluteUrl);
        return descriptor ? `${proxiedPath} ${descriptor}` : proxiedPath;
      }).join(', ');
      
      return `srcset=${quote}${rewritten}${quote}`;
    });
    
    // Rewrite CSS url() references in inline styles
    result = result.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, value) => {
      if (value.startsWith('data:') || value.startsWith('#')) return match;
      
      let absoluteUrl;
      if (value.startsWith('//')) {
        absoluteUrl = url.protocol + value;
      } else if (value.startsWith('/')) {
        absoluteUrl = origin + value;
      } else if (value.startsWith('http://') || value.startsWith('https://')) {
        absoluteUrl = value;
      } else {
        const basePath = url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
        absoluteUrl = origin + basePath + value;
      }
      
      const proxiedPath = PROXY_PREFIX + encodeUrl(absoluteUrl);
      return `url(${proxiedPath})`;
    });
    
    // Inject base tag for relative URL resolution
    if (!result.includes('<base')) {
      result = result.replace(/<head[^>]*>/i, `<head><base href="${PROXY_PREFIX}${encodeUrl(origin + url.pathname)}">`);
    }
    
    return result;
  } catch (e) {
    console.error('[SW] Failed to rewrite HTML:', e);
    return html;
  }
}

/**
 * Rewrites CSS content to proxy URLs
 */
function rewriteCss(css, baseUrl) {
  if (!css) return css;
  
  try {
    const url = new URL(baseUrl);
    const origin = url.origin;
    
    return css.replace(/@import\s+url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, value) => {
      let absoluteUrl = resolveUrl(value, url);
      const proxiedPath = PROXY_PREFIX + encodeUrl(absoluteUrl);
      return `@import url(${proxiedPath})`;
    }).replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, value) => {
      if (value.startsWith('data:')) return match;
      let absoluteUrl = resolveUrl(value, url);
      const proxiedPath = PROXY_PREFIX + encodeUrl(absoluteUrl);
      return `url(${proxiedPath})`;
    });
  } catch (e) {
    return css;
  }
}

/**
 * Resolves a relative URL against a base URL
 */
function resolveUrl(value, baseUrl) {
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  if (value.startsWith('//')) {
    return baseUrl.protocol + value;
  }
  if (value.startsWith('/')) {
    return baseUrl.origin + value;
  }
  const basePath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
  return baseUrl.origin + basePath + value;
}

/**
 * Main fetch event handler - intercepts all requests
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Skip non-http(s) requests
  if (!['http:', 'https:'].includes(url.protocol)) {
    return;
  }
  
  // Skip requests to our own domain (static assets, API, etc.)
  if (url.origin === self.location.origin) {
    // But handle proxied paths
    if (url.pathname.startsWith(PROXY_PREFIX)) {
      event.respondWith(handleProxiedRequest(request));
    }
    return;
  }
  
  // Intercept and proxy all external requests
  event.respondWith(interceptRequest(request));
});

/**
 * Handles requests that are already proxied (coming from /proxy/*)
 */
async function handleProxiedRequest(request) {
  try {
    const url = new URL(request.url);
    const encodedPath = url.pathname.substring(PROXY_PREFIX.length);
    
    if (!encodedPath) {
      return fetch(request);
    }
    
    // Decode to get original URL
    let originalUrl;
    try {
      originalUrl = decodeUrl(encodedPath);
    } catch (e) {
      return new Response('Invalid encoded URL', { status: 400 });
    }
    
    // Create new request to the actual target
    const modifiedRequest = new Request(originalUrl, {
      method: request.method,
      headers: request.headers,
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    });
    
    const response = await fetch(modifiedRequest);
    
    // Clone response for potential rewriting
    const contentType = response.headers.get('content-type') || '';
    
    // Handle different content types
    if (contentType.includes('text/html')) {
      const html = await response.text();
      const rewritten = rewriteHtml(html, originalUrl);
      return new Response(rewritten, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    
    if (contentType.includes('text/css')) {
      const css = await response.text();
      const rewritten = rewriteCss(css, originalUrl);
      return new Response(rewritten, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    
    if (contentType.includes('application/javascript') || 
        contentType.includes('text/javascript')) {
      // Basic JS rewriting (more advanced would parse and rewrite fetch/XHR calls)
      const js = await response.text();
      // Could add JS rewriting here for advanced scenarios
      return new Response(js, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    
    // Return other content types as-is (images, videos, fonts, etc.)
    return response;
    
  } catch (error) {
    console.error('[SW] Proxy error:', error);
    return new Response(`Proxy Error: ${error.message}`, { 
      status: 502,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

/**
 * Intercepts external requests and routes them through our proxy
 */
async function interceptRequest(request) {
  try {
    const url = new URL(request.url);
    
    // Encode the URL and route through our proxy
    const encodedUrl = encodeUrl(url.toString());
    const proxiedUrl = `${self.location.origin}${PROXY_PREFIX}${encodedUrl}`;
    
    const modifiedRequest = new Request(proxiedUrl, {
      method: request.method,
      headers: request.headers,
      credentials: 'include',
      mode: 'cors',
      cache: 'no-store',
      redirect: 'follow',
    });
    
    return await fetch(modifiedRequest);
    
  } catch (error) {
    console.error('[SW] Intercept error:', error);
    return fetch(request); // Fallback to direct request
  }
}

/**
 * WebSocket proxying support
 * Note: Full WebSocket proxying requires backend support
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'WS_PROXY') {
    // WebSocket proxying logic would go here
    // This is a placeholder for future implementation
    console.log('[SW] WS_PROXY message received');
  }
});

/**
 * Service Worker installation
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Diamond Service Worker v' + SW_VERSION);
  self.skipWaiting(); // Activate immediately
});

/**
 * Service Worker activation - clean up old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Diamond Service Worker v' + SW_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          // Keep only current version caches
          if (!name.startsWith('diamond-')) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim(); // Take control of all clients immediately
});
