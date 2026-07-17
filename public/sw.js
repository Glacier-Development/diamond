/**
 * Diamond Service Worker - Interception Engine v2.0
 * 
 * Uses encodeURIComponent scheme matching browser.js exactly
 * Prefix: /proxy/~/
 */

const PROXY_PREFIX = '/proxy/~/';
const SW_VERSION = '2.0.0';

// URL Encoding/Decoding - MUST MATCH browser.js EXACTLY
function encodeUrl(str) {
  if (!str) return '';
  try {
    const encoded = encodeURIComponent(str);
    return encoded.replace(/%/g, '-');
  } catch (e) {
    console.error('[SW] Encode error:', e);
    return '';
  }
}

function decodeUrl(encoded) {
  if (!encoded) return '';
  try {
    // Restore % signs
    const withPercent = encoded.replace(/-/g, '%');
    return decodeURIComponent(withPercent);
  } catch (e) {
    console.error('[SW] Decode error for:', encoded.substring(0, 100), e);
    return '';
  }
}

/**
 * Rewrites URLs in HTML content to use the proxy
 */
function rewriteHtml(html, baseUrl) {
  if (!html || typeof html !== 'string') return html;

  try {
    const url = new URL(baseUrl);
    const origin = url.origin;

    let result = html;

    // Rewrite href, src, action, etc attributes
    result = result.replace(/(href|src|action|data-src|poster|data-href)\s*=\s*(["'])([^"']+)(\2)/gi, (match, attr, quote, value) => {
      if (value.startsWith('data:') || value.startsWith('javascript:') || 
          value.startsWith('mailto:') || value.startsWith('tel:') || 
          value.startsWith('#') || value.startsWith('blob:')) {
        return match;
      }

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
      return `${attr}=${quote}${proxiedPath}${quote}`;
    });

    // Rewrite srcset
    result = result.replace(/srcset\s*=\s*(["'])([^"']+)(\1)/gi, (match, quote, value) => {
      const rewritten = value.split(',').map(part => {
        const trimmed = part.trim();
        const spaceIndex = trimmed.indexOf(' ');
        let urlPart, descriptor;
        if (spaceIndex === -1) {
          urlPart = trimmed;
          descriptor = '';
        } else {
          urlPart = trimmed.substring(0, spaceIndex);
          descriptor = trimmed.substring(spaceIndex);
        }
        
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
        return descriptor ? `${proxiedPath}${descriptor}` : proxiedPath;
      }).join(', ');

      return `srcset=${quote}${rewritten}${quote}`;
    });

    // Rewrite CSS url() in inline styles
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

    // Inject base tag
    if (!result.includes('<base')) {
      result = result.replace(/<head[^>]*>/i, `<head><base href="${origin}${url.pathname}">`);
    }

    return result;
  } catch (e) {
    console.error('[SW] Failed to rewrite HTML:', e);
    return html;
  }
}

/**
 * Rewrites CSS content
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

function resolveUrl(value, baseUrl) {
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (value.startsWith('//')) return baseUrl.protocol + value;
  if (value.startsWith('/')) return baseUrl.origin + value;
  const basePath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
  return baseUrl.origin + basePath + value;
}

/**
 * Main fetch handler
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (!['http:', 'https:'].includes(url.protocol)) return;

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith(PROXY_PREFIX)) {
      event.respondWith(handleProxiedRequest(request));
    }
    return;
  }

  event.respondWith(interceptRequest(request));
});

/**
 * Handle proxied requests (/proxy/~/...)
 */
async function handleProxiedRequest(request) {
  try {
    const url = new URL(request.url);
    const encodedPath = url.pathname.substring(PROXY_PREFIX.length);

    if (!encodedPath) {
      return fetch(request);
    }

    let originalUrl;
    try {
      originalUrl = decodeUrl(encodedPath);
      
      if (!originalUrl.startsWith('http://') && !originalUrl.startsWith('https://')) {
        throw new Error('Invalid URL after decoding: ' + originalUrl);
      }
    } catch (e) {
      console.error('[SW] Decode failed:', e, 'Encoded:', encodedPath.substring(0, 200));
      return new Response(`Invalid encoded URL: ${e.message}`, { 
        status: 400,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    const modifiedRequest = new Request(originalUrl, {
      method: request.method,
      headers: request.headers,
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
    });

    const response = await fetch(modifiedRequest);
    const contentType = response.headers.get('content-type') || '';

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

    // Return JS and other content as-is
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
 * Intercept external requests
 */
async function interceptRequest(request) {
  try {
    const url = new URL(request.url);
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
    return fetch(request);
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'WS_PROXY') {
    console.log('[SW] WS_PROXY message received');
  }
});

self.addEventListener('install', (event) => {
  console.log('[SW] Installing Diamond SW v' + SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Diamond SW v' + SW_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (!name.startsWith('diamond-')) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});
