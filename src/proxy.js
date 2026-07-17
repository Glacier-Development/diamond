const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const iconv = require('iconv-lite');

// Base64url encoding/decoding for URL obfuscation
function encodeUrl(str) {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function decodeUrl(str) {
  return Buffer.from(str, 'base64url').toString('utf-8');
}

/**
 * Rewrites a client URL to the proxy path
 * @param {string} url - The original URL to proxy
 * @returns {string} - The proxied URL path
 */
function rewriteUrl(url, baseUrl) {
  // Handle URLs that are already proxied
  if (url.startsWith('/proxy/')) {
    return url;
  }
  
  // Resolve relative URLs against base URL
  if (baseUrl && !url.match(/^https?:\/\//i)) {
    try {
      url = new URL(url, baseUrl).href;
    } catch (e) {
      // If resolution fails, continue with original
    }
  }
  
  // Add protocol if missing
  if (!url.match(/^https?:\/\//i)) {
    url = 'https://' + url;
  }
  
  try {
    // Validate URL format
    new URL(url);
  } catch (e) {
    throw new Error('Invalid URL format');
  }
  
  return `/proxy/${encodeUrl(url)}`;
}

/**
 * Extracts the original URL from a proxied request path
 * @param {string} path - The request path containing encoded URL
 * @returns {string} - The decoded original URL
 */
function extractUrl(path) {
  const match = path.match(/^\/proxy\/(.+)$/);
  if (!match) {
    throw new Error('Invalid proxy path');
  }
  
  try {
    return decodeUrl(match[1]);
  } catch (e) {
    throw new Error('Failed to decode URL');
  }
}

/**
 * Rewrites HTML content to use proxied URLs
 * @param {string} html - Original HTML content
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @returns {string} - Rewritten HTML content
 */
function rewriteHtml(html, baseUrl) {
  if (!html || typeof html !== 'string') return html;
  
  let result = html;
  
  // Rewrite common URL attributes
  const urlAttributes = [
    'src', 'href', 'action', 'data', 'poster', 'background',
    'srcset', 'data-src', 'data-href', 'data-background',
    'data-poster', 'data-video', 'data-audio'
  ];
  
  // Pattern to match URL attributes in HTML tags
  urlAttributes.forEach(attr => {
    // Match attribute="value" or attribute='value'
    const pattern = new RegExp(`(${attr}\\s*=\\s*)(["'])((?:(?!\\2).)+?)\\2`, 'gi');
    result = result.replace(pattern, (match, prefix, quote, url) => {
      // Skip data URLs, javascript:, mailto:, tel:, etc.
      if (url.startsWith('data:') || 
          url.startsWith('javascript:') || 
          url.startsWith('mailto:') || 
          url.startsWith('tel:') ||
          url.startsWith('#') ||
          url.startsWith('blob:')) {
        return match;
      }
      
      // Skip if already proxied
      if (url.startsWith('/proxy/')) {
        return match;
      }
      
      try {
        const proxiedUrl = rewriteUrl(url, baseUrl);
        return `${prefix}${quote}${proxiedUrl}${quote}`;
      } catch (e) {
        return match;
      }
    });
    
    // Handle srcset specifically (multiple URLs)
    if (attr === 'srcset') {
      const srcsetPattern = new RegExp(`(${attr}\\s*=\\s*)(["'])(.+?)\\2`, 'gi');
      result = result.replace(srcsetPattern, (match, prefix, quote, srcset) => {
        const urls = srcset.split(',').map(part => {
          const trimmed = part.trim();
          const parts = trimmed.split(/\s+/);
          if (parts.length === 0) return '';
          
          const url = parts[0];
          const descriptor = parts.slice(1).join(' ');
          
          if (url.startsWith('data:') || url.startsWith('/proxy/')) {
            return trimmed;
          }
          
          try {
            const proxiedUrl = rewriteUrl(url, baseUrl);
            return descriptor ? `${proxiedUrl} ${descriptor}` : proxiedUrl;
          } catch (e) {
            return trimmed;
          }
        });
        
        return `${prefix}${quote}${urls.join(', ')}${quote}`;
      });
    }
  });
  
  // Rewrite CSS in style tags
  result = result.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, css) => {
    const rewrittenCss = rewriteCss(css, baseUrl);
    return match.replace(css, rewrittenCss);
  });
  
  // Rewrite inline styles
  result = result.replace(/style\s*=\s*(["'])([^"']*?)\1/gi, (match, quote, style) => {
    const rewrittenStyle = rewriteCss(style, baseUrl);
    return `style=${quote}${rewrittenStyle}${quote}`;
  });
  
  return result;
}

/**
 * Rewrites CSS content to use proxied URLs
 * @param {string} css - Original CSS content
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @returns {string} - Rewritten CSS content
 */
function rewriteCss(css, baseUrl) {
  if (!css || typeof css !== 'string') return css;
  
  // Rewrite url() in CSS
  return css.replace(/url\s*\(\s*(["']?)([^"'\)]+)\1\s*\)/gi, (match, quote, url) => {
    url = url.trim();
    
    // Skip data URLs and already proxied URLs
    if (url.startsWith('data:') || url.startsWith('/proxy/')) {
      return match;
    }
    
    try {
      const proxiedUrl = rewriteUrl(url, baseUrl);
      return `url(${quote}${proxiedUrl}${quote})`;
    } catch (e) {
      return match;
    }
  });
}

/**
 * Rewrites JavaScript to handle fetch/XHR through proxy
 * @param {string} js - Original JavaScript content
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @returns {string} - Rewritten JavaScript content
 */
function rewriteJs(js, baseUrl) {
  if (!js || typeof js !== 'string') return js;
  
  let result = js;
  
  // Rewrite fetch calls
  result = result.replace(/fetch\s*\(\s*(["'`])([^"'`]+)\1/g, (match, quote, url) => {
    if (url.startsWith('data:') || url.startsWith('/proxy/') || url.startsWith('http')) {
      try {
        const proxiedUrl = rewriteUrl(url, baseUrl);
        return `fetch("${proxiedUrl}"`;
      } catch (e) {
        return match;
      }
    }
    return match;
  });
  
  // Rewrite XMLHttpRequest.open calls
  result = result.replace(/\.open\s*\(\s*(["'][^"']+["'])\s*,\s*(["'])([^"']+)\2/g, (match, method, urlQuote, url) => {
    if (url.startsWith('data:') || url.startsWith('/proxy/') || url.startsWith('http')) {
      try {
        const proxiedUrl = rewriteUrl(url, baseUrl);
        return `.open(${method}, "${proxiedUrl}"`;
      } catch (e) {
        return match;
      }
    }
    return match;
  });
  
  return result;
}

/**
 * Advanced proxy handler with Scramjet-like features
 * Supports video streaming, content rewriting, and more
 */
async function proxyHandler(req, res) {
  const startTime = Date.now();
  
  try {
    // Extract the target URL from the request path
    let targetUrl;
    try {
      targetUrl = extractUrl(req.path);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid proxy URL' });
    }
    
    // Validate URL scheme (only allow http/https)
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(403).json({ error: 'Protocol not allowed' });
    }
    
    // Block internal/private networks for security
    const hostname = parsedUrl.hostname.toLowerCase();
    if (hostname === 'localhost' || 
        hostname === '127.0.0.1' || 
        hostname === '::1' ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) {
      return res.status(403).json({ error: 'Access to private networks denied' });
    }
    
    // Build request options with improved connection handling
    const isHttps = parsedUrl.protocol === 'https:';
    
    // Create custom agent with better connection pooling
    const agentOptions = {
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 50,
      maxFreeSockets: 10,
      timeout: 60000,
      rejectUnauthorized: false // Allow self-signed certs (for compatibility)
    };
    
    const agent = isHttps 
      ? new https.Agent(agentOptions)
      : new http.Agent(agentOptions);
    
    // Build request headers
    const forwardedHeaders = {
      'accept': req.headers.accept || '*/*',
      'accept-language': req.headers['accept-language'],
      'accept-encoding': 'identity', // Don't accept compressed responses we can't handle
      'cache-control': req.headers['cache-control'],
      'if-modified-since': req.headers['if-modified-since'],
      'if-none-match': req.headers['if-none-match'],
      'range': req.headers.range, // Critical for video streaming!
      'content-type': req.headers['content-type'],
      'authorization': req.headers.authorization,
    };
    
    // Clean undefined headers
    Object.keys(forwardedHeaders).forEach(key => {
      if (forwardedHeaders[key] === undefined) {
        delete forwardedHeaders[key];
      }
    });
    
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: req.method,
      headers: {
        ...forwardedHeaders,
        'host': parsedUrl.host,
        'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      agent: agent,
      timeout: 120000, // 2 minute timeout for large files
      rejectUnauthorized: false,
    };
    
    // Only add referer and origin if they contain valid characters
    try {
      const safeReferer = targetUrl.replace(/[^\x20-\x7E]/g, '');
      const safeOrigin = `${parsedUrl.protocol}//${parsedUrl.host}`.replace(/[^\x20-\x7E]/g, '');
      if (safeReferer && /^[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/.test(safeReferer)) {
        requestOptions.headers.referer = safeReferer;
      }
      if (safeOrigin && /^[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/.test(safeOrigin)) {
        requestOptions.headers.origin = safeOrigin;
      }
    } catch (e) {
      // Skip adding these headers if validation fails
    }
    
    // Handle HEAD and OPTIONS requests
    if (req.method === 'HEAD') {
      const client = isHttps ? https : http;
      const proxyReq = client.request(requestOptions, (proxyRes) => {
        // Copy headers
        const safeHeaders = ['content-type', 'content-length', 'last-modified', 'etag', 'cache-control'];
        safeHeaders.forEach(header => {
          if (proxyRes.headers[header]) {
            res.setHeader(header, proxyRes.headers[header]);
          }
        });
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
        res.status(proxyRes.statusCode || 200).end();
      });
      
      proxyReq.on('error', handleProxyError);
      proxyReq.end();
      return;
    }
    
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
      return res.status(204).end();
    }
    
    // Collect request body for POST/PUT/PATCH
    let requestBody = null;
    const bodyPromise = new Promise((resolve) => {
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          requestBody = Buffer.concat(chunks);
          resolve();
        });
        req.on('error', () => resolve());
      } else {
        resolve();
      }
    });
    
    await bodyPromise;
    
    if (requestBody && requestBody.length > 0) {
      requestOptions.headers['content-length'] = requestBody.length;
    }
    
    // Make the proxied request
    const client = isHttps ? https : http;
    const proxyReq = client.request(requestOptions);
    
    // Handle proxy request errors
    function handleProxyError(err) {
      console.error(`[PROXY ERROR] ${targetUrl}:`, err.message);
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json');
        res.status(502).json({ 
          error: 'Failed to connect to target server', 
          details: err.message,
          code: err.code
        });
      }
    }
    
    proxyReq.on('error', handleProxyError);
    
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json');
        res.status(504).json({ error: 'Request timeout' });
      }
    });
    
    // Send request body if present
    if (requestBody) {
      proxyReq.write(requestBody);
    }
    proxyReq.end();
    
    // Handle response
    proxyReq.on('response', async (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      const contentLength = proxyRes.headers['content-length'];
      const contentEncoding = proxyRes.headers['content-encoding'];
      
      // Determine if we should rewrite content
      const isHtml = contentType.includes('text/html');
      const isCss = contentType.includes('text/css');
      const isJs = contentType.includes('javascript') || contentType.includes('application/x-javascript');
      const isJson = contentType.includes('application/json');
      const isVideo = contentType.includes('video/');
      const isAudio = contentType.includes('audio/');
      const isImage = contentType.includes('image/');
      
      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
        const location = proxyRes.headers.location;
        if (location) {
          try {
            const proxiedLocation = rewriteUrl(location, targetUrl);
            res.setHeader('Location', proxiedLocation);
          } catch (e) {
            res.setHeader('Location', location);
          }
        }
        return res.status(proxyRes.statusCode).end();
      }
      
      // Set CORS headers for all responses
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range, X-Requested-With');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      
      // Copy safe response headers
      const safeHeaders = [
        'content-type', 'content-length', 'last-modified', 'etag', 
        'cache-control', 'expires', 'accept-ranges', 'content-range',
        'content-disposition'
      ];
      
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        const lowerKey = key.toLowerCase();
        // Skip dangerous or problematic headers
        if (safeHeaders.includes(lowerKey) && value) {
          res.setHeader(key, value);
        }
      }
      
      // Important: Don't set content-encoding if we're going to decompress and rewrite
      if (contentEncoding) {
        res.removeHeader('content-encoding');
      }
      
      // Remove security headers that might block proxy functionality
      res.removeHeader('strict-transport-security');
      res.removeHeader('content-security-policy');
      res.removeHeader('x-frame-options');
      res.removeHeader('x-content-type-options');
      
      // Handle cookies - rewrite domains
      if (proxyRes.headers['set-cookie']) {
        const cookies = Array.isArray(proxyRes.headers['set-cookie']) 
          ? proxyRes.headers['set-cookie'] 
          : [proxyRes.headers['set-cookie']];
        
        const rewrittenCookies = cookies.map(cookie => {
          // Remove domain and path restrictions
          let rewritten = cookie
            .replace(/;\s*domain=[^;]+/gi, '')
            .replace(/;\s*path=[^;]+/gi, '; Path=/')
            .replace(/;\s*secure/gi, '')
            .replace(/;\s*samesite=[^;]+/gi, '');
          return rewritten;
        });
        
        res.setHeader('set-cookie', rewrittenCookies);
      }
      
      // Send response status
      res.status(proxyRes.statusCode || 200);
      
      // For video/audio/images, stream directly without modification
      if (isVideo || isAudio || isImage) {
        proxyRes.pipe(res);
        return;
      }
      
      // For text-based content, we may need to decompress and rewrite
      if (isHtml || isCss || isJs || isJson) {
        let responseData = Buffer.alloc(0);
        
        // Create appropriate decompression stream
        let decompressStream;
        if (contentEncoding === 'gzip') {
          decompressStream = zlib.createGunzip();
        } else if (contentEncoding === 'deflate') {
          decompressStream = zlib.createInflate();
        } else if (contentEncoding === 'br') {
          // Brotli - just pass through without decompression for now
          decompressStream = null;
        }
        
        const collectChunks = (chunk) => {
          responseData = Buffer.concat([responseData, chunk]);
        };
        
        const finishProcessing = () => {
          try {
            // Detect charset
            let charset = 'utf-8';
            const charsetMatch = contentType.match(/charset=([^;]+)/i);
            if (charsetMatch) {
              charset = charsetMatch[1].trim();
            }
            
            // Convert to string for rewriting
            let content;
            try {
              content = iconv.decode(responseData, charset);
            } catch (e) {
              content = responseData.toString('utf-8');
            }
            
            // Rewrite content based on type
            if (isHtml) {
              content = rewriteHtml(content, targetUrl);
            } else if (isCss) {
              content = rewriteCss(content, targetUrl);
            } else if (isJs) {
              content = rewriteJs(content, targetUrl);
            }
            
            // Send rewritten content
            const outputBuffer = iconv.encode(content, 'utf-8');
            res.setHeader('Content-Length', outputBuffer.length);
            res.end(outputBuffer);
            
          } catch (rewriteError) {
            console.error('[REWRITE ERROR]', rewriteError.message);
            // Fallback: send original content
            res.setHeader('Content-Length', responseData.length);
            res.end(responseData);
          }
        };
        
        if (decompressStream) {
          decompressStream.on('data', collectChunks);
          decompressStream.on('end', finishProcessing);
          decompressStream.on('error', () => {
            // Decompression failed, send raw data
            finishProcessing();
          });
          proxyRes.pipe(decompressStream);
        } else {
          // No decompression needed
          proxyRes.on('data', collectChunks);
          proxyRes.on('end', finishProcessing);
        }
      } else {
        // Stream other content types directly
        proxyRes.pipe(res);
      }
      
      // Log successful proxy
      const duration = Date.now() - startTime;
      console.log(`[PROXY] ${req.method} ${targetUrl} -> ${proxyRes.statusCode} (${duration}ms)`);
    });
    
  } catch (error) {
    console.error('[PROXY HANDLER ERROR]', error.message);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.status(500).json({ error: 'Proxy error', details: error.message });
    }
  }
}

module.exports = {
  proxyHandler,
  rewriteUrl,
  extractUrl,
  encodeUrl,
  decodeUrl,
  rewriteHtml,
  rewriteCss,
  rewriteJs
};
