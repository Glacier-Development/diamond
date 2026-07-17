/**
 * Diamond Proxy Engine v3.0
 * Advanced proxy engine with Scramjet-inspired architecture
 * Features: Video streaming, content rewriting, codec support, optimized performance
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const iconv = require('iconv-lite');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const stream = require('stream');

// ============================================================================
// Configuration and Constants
// ============================================================================

const MAX_SOCKETS = 256;
const FREE_SOCKET_TIMEOUT = 30000;
const REQUEST_TIMEOUT = 120000;
const VIDEO_CODECS = ['h264', 'vp9', 'av1', 'hevc'];
const AUDIO_CODECS = ['aac', 'opus', 'mp3', 'vorbis'];
const MEDIA_TYPES = {
  video: ['video/mp4', 'video/webm', 'video/ogg', 'video/x-matroska'],
  audio: ['audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/aac', 'audio/opus'],
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']
};

// ============================================================================
// Connection Pool Manager (Similar to Scramjet's connection management)
// ============================================================================

class ConnectionPool extends EventEmitter {
  constructor() {
    super();
    this.httpAgent = new http.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: MAX_SOCKETS,
      maxFreeSockets: 64,
      timeout: FREE_SOCKET_TIMEOUT,
      scheduling: 'lifo'
    });
    
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: MAX_SOCKETS,
      maxFreeSockets: 64,
      timeout: FREE_SOCKET_TIMEOUT,
      rejectUnauthorized: false,
      secureProtocol: 'TLS_method',
      scheduling: 'lifo'
    });
    
    this.setupAgents();
  }
  
  setupAgents() {
    // Monitor socket usage
    setInterval(() => {
      this.emit('stats', {
        http: { sockets: this.httpAgent.sockets?.length || 0, freeSockets: this.httpAgent.freeSockets?.length || 0 },
        https: { sockets: this.httpsAgent.sockets?.length || 0, freeSockets: this.httpsAgent.freeSockets?.length || 0 }
      });
    }, 10000);
  }
  
  getAgent(isHttps) {
    return isHttps ? this.httpsAgent : this.httpAgent;
  }
  
  destroy() {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }
}

// Global connection pool
const connectionPool = new ConnectionPool();

// ============================================================================
// URL Encoding/Decoding (Base64URL for obfuscation)
// ============================================================================

function encodeUrl(str) {
  if (!str) return str;
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function decodeUrl(str) {
  if (!str) return str;
  try {
    return Buffer.from(str, 'base64url').toString('utf-8');
  } catch (e) {
    throw new Error('Failed to decode URL');
  }
}

function extractUrlFromPath(path) {
  // Handle both /proxy/~/base64url and legacy /proxy/encoded formats
  const match = path.match(/^\/proxy\/(?:~\/)?(.+)$/);
  if (!match) {
    throw new Error('Invalid proxy path');
  }
  return decodeUrl(match[1]);
}

// ============================================================================
// URL Rewriting Engine
// ============================================================================

function rewriteUrl(url, baseUrl = null) {
  if (!url || typeof url !== 'string') return url;
  
  // Already proxied
  if (url.startsWith('/proxy/~/')) return url;
  
  // Skip special protocols
  const skipProtocols = ['data:', 'javascript:', 'mailto:', 'tel:', 'blob:', '#'];
  for (const protocol of skipProtocols) {
    if (url.startsWith(protocol)) return url;
  }
  
  // Handle protocol-relative URLs
  if (url.startsWith('//')) {
    url = 'https:' + url;
  }
  
  // Resolve relative URLs
  if (baseUrl && !/^https?:\/\//i.test(url)) {
    try {
      url = new URL(url, baseUrl).href;
    } catch (e) {
      return url;
    }
  }
  
  // Add default protocol
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }
  
  // Validate
  try {
    new URL(url);
  } catch (e) {
    return url;
  }
  
  return `/proxy/~/${encodeUrl(url)}`;
}

function rewriteSrcSet(srcset, baseUrl) {
  if (!srcset) return srcset;
  
  return srcset.split(',').map(part => {
    const trimmed = part.trim();
    const spaceIndex = trimmed.indexOf(' ');
    
    if (spaceIndex === -1) {
      return rewriteUrl(trimmed, baseUrl);
    }
    
    const url = trimmed.substring(0, spaceIndex);
    const descriptor = trimmed.substring(spaceIndex + 1);
    return `${rewriteUrl(url, baseUrl)} ${descriptor}`;
  }).join(', ');
}

// ============================================================================
// Content Rewriting Engine
// ============================================================================

class ContentRewriter {
  constructor() {
    this.urlAttributes = [
      'src', 'href', 'action', 'data', 'poster', 'background',
      'srcset', 'data-src', 'data-href', 'data-background',
      'data-poster', 'data-video', 'data-audio', 'data-srcset',
      'content', 'url', 'thumbnail', 'imagesrc', 'xlink:href'
    ];
  }
  
  rewriteHtml(html, baseUrl) {
    if (!html || typeof html !== 'string') return html;
    
    let result = html;
    
    // Inject base tag for proper relative URL resolution in iframe
    if (!result.includes('<base') && result.includes('<head')) {
      result = result.replace(/<head[^>]*>/i, `<head><base href="${baseUrl}" target="_top">`);
    }
    
    // Rewrite URL attributes
    for (const attr of this.urlAttributes) {
      if (attr === 'srcset') {
        // Handle srcset specially (multiple URLs)
        const pattern = new RegExp(`(${attr})\\s*=\\s*(["'])((?:(?!\\2).)+?)\\2`, 'gi');
        result = result.replace(pattern, (match, name, quote, value) => {
          const rewritten = rewriteSrcSet(value, baseUrl);
          return `${name}=${quote}${rewritten}${quote}`;
        });
      } else {
        // Single URL attributes
        const pattern = new RegExp(`(${attr})\\s*=\\s*(["'])((?:(?!\\2).)+?)\\2`, 'gi');
        result = result.replace(pattern, (match, name, quote, value) => {
          const rewritten = rewriteUrl(value, baseUrl);
          return `${name}=${quote}${rewritten}${quote}`;
        });
      }
    }
    
    // Rewrite CSS in style tags
    result = result.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, css) => {
      return match.replace(css, this.rewriteCss(css, baseUrl));
    });
    
    // Rewrite inline styles
    result = result.replace(/style\s*=\s*(["'])([^"']*?)\1/gi, (match, quote, style) => {
      return `style=${quote}${this.rewriteCss(style, baseUrl)}${quote}`;
    });
    
    // Inject service worker interceptor script
    if (result.includes('</body>')) {
      const swScript = `
        <script>
        (function() {
          const _fetch = window.fetch;
          const _xhrOpen = XMLHttpRequest.prototype.open;
          const _xhrSend = XMLHttpRequest.prototype.send;
          
          window.fetch = function(...args) {
            if (args[0] && typeof args[0] === 'string' && !args[0].startsWith('/proxy/~/') && !args[0].startsWith('data:')) {
              args[0] = '/proxy/~/' + btoa(args[0]).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
            }
            return _fetch.apply(this, args);
          };
          
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            if (url && !url.startsWith('/proxy/~/') && !url.startsWith('data:')) {
              url = '/proxy/~/' + btoa(url).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
            }
            this._diamondUrl = url;
            return _xhrOpen.call(this, method, url, ...rest);
          };
        })();
        </script>
      `;
      result = result.replace('</body>', swScript + '</body>');
    }
    
    return result;
  }
  
  rewriteCss(css, baseUrl) {
    if (!css || typeof css !== 'string') return css;
    
    // Rewrite url() references
    return css.replace(/url\s*\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, url) => {
      url = url.trim();
      if (url.startsWith('data:') || url.startsWith('/proxy/~/')) {
        return match;
      }
      const rewritten = rewriteUrl(url, baseUrl);
      return `url(${quote}${rewritten}${quote})`;
    });
  }
  
  rewriteJs(js, baseUrl) {
    if (!js || typeof js !== 'string') return js;
    
    let result = js;
    
    // Rewrite fetch calls
    result = result.replace(/fetch\s*\(\s*(["'`])([^"'`]+)\1/g, (match, quote, url) => {
      if (url.startsWith('/proxy/~/') || url.startsWith('data:')) return match;
      return `fetch("${rewriteUrl(url, baseUrl)}"`;
    });
    
    // Rewrite XMLHttpRequest.open
    result = result.replace(/\.open\s*\(\s*(["'][^"']+["'])\s*,\s*(["'])([^"']+)\2/g, (match, method, q, url) => {
      if (url.startsWith('/proxy/~/') || url.startsWith('data:')) return match;
      return `.open(${method}, "${rewriteUrl(url, baseUrl)}"`;
    });
    
    return result;
  }
}

const rewriter = new ContentRewriter();

// ============================================================================
// Security Utilities
// ============================================================================

function isPrivateIP(hostname) {
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^::1$/,
    /^fe80:/,
    /^fc00:/
  ];
  
  return privatePatterns.some(pattern => pattern.test(hostname));
}

function sanitizeHeaders(headers) {
  const safeHeaders = {};
  const allowedHeaders = [
    'accept', 'accept-language', 'accept-encoding', 'cache-control',
    'if-modified-since', 'if-none-match', 'range', 'content-type',
    'authorization', 'referer', 'origin', 'user-agent', 'cookie'
  ];
  
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (allowedHeaders.includes(lowerKey) && value) {
      // Sanitize header values
      const sanitized = String(value).replace(/[^\x20-\x7E]/g, '');
      if (sanitized) {
        safeHeaders[key] = sanitized;
      }
    }
  }
  
  return safeHeaders;
}

// ============================================================================
// Media Type Detection
// ============================================================================

function getMediaType(contentType) {
  if (!contentType) return null;
  
  const ct = contentType.toLowerCase();
  
  for (const [type, mimeTypes] of Object.entries(MEDIA_TYPES)) {
    if (mimeTypes.some(mime => ct.includes(mime))) {
      return type;
    }
  }
  
  if (ct.includes('text/html')) return 'html';
  if (ct.includes('text/css')) return 'css';
  if (ct.includes('javascript') || ct.includes('application/x-javascript')) return 'js';
  if (ct.includes('application/json')) return 'json';
  
  return null;
}

function shouldStreamDirectly(contentType) {
  const mediaType = getMediaType(contentType);
  return mediaType === 'video' || mediaType === 'audio' || mediaType === 'image';
}

// ============================================================================
// Decompression Handler
// ============================================================================

function createDecompressStream(encoding) {
  switch (encoding) {
    case 'gzip':
      return zlib.createGunzip();
    case 'deflate':
      return zlib.createInflate();
    case 'br':
      // Brotli not supported in standard Node.js without additional deps
      return null;
    default:
      return null;
  }
}

// ============================================================================
// Main Proxy Handler
// ============================================================================

async function proxyHandler(req, res) {
  const startTime = Date.now();
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    // Extract target URL
    let targetUrl;
    try {
      targetUrl = extractUrlFromPath(req.path);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid proxy URL format' });
    }
    
    // Parse and validate URL
    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    
    // Protocol check
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(403).json({ error: 'Protocol not allowed' });
    }
    
    // Security: Block private networks
    if (isPrivateIP(parsedUrl.hostname)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Determine HTTPS
    const isHttps = parsedUrl.protocol === 'https:';
    
    // Build request options
    const headers = sanitizeHeaders(req.headers);
    headers.host = parsedUrl.host;
    headers['user-agent'] = headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
    headers['accept-encoding'] = 'identity'; // Don't accept compression we can't handle
    
    // Preserve range header for video seeking
    if (req.headers.range) {
      headers.range = req.headers.range;
    }
    
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: req.method,
      headers,
      agent: connectionPool.getAgent(isHttps),
      timeout: REQUEST_TIMEOUT,
      rejectUnauthorized: false
    };
    
    // Handle preflight OPTIONS
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
      return res.status(204).end();
    }
    
    // Handle HEAD requests
    if (req.method === 'HEAD') {
      const client = isHttps ? https : http;
      const proxyReq = client.request(requestOptions, (proxyRes) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
        
        const forwardHeaders = ['content-type', 'content-length', 'last-modified', 'etag', 'cache-control', 'accept-ranges'];
        for (const header of forwardHeaders) {
          if (proxyRes.headers[header]) {
            res.setHeader(header, proxyRes.headers[header]);
          }
        }
        
        res.status(proxyRes.statusCode || 200).end();
      });
      
      proxyReq.on('error', (err) => {
        console.error(`[PROXY:${requestId}] HEAD error:`, err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Proxy connection failed' });
        }
      });
      
      proxyReq.end();
      return;
    }
    
    // Collect body for POST/PUT/PATCH
    let requestBody = null;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      requestBody = Buffer.concat(chunks);
      if (requestBody.length > 0) {
        requestOptions.headers['content-length'] = requestBody.length;
      }
    }
    
    // Make the proxy request
    const client = isHttps ? https : http;
    const proxyReq = client.request(requestOptions);
    
    // Timeout handling
    proxyReq.setTimeout(REQUEST_TIMEOUT, () => {
      proxyReq.destroy(new Error('Request timeout'));
    });
    
    // Error handling
    proxyReq.on('error', (err) => {
      console.error(`[PROXY:${requestId}] Error:`, err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Proxy connection failed', details: err.message });
      }
    });
    
    // Send body if present
    if (requestBody) {
      proxyReq.write(requestBody);
    }
    proxyReq.end();
    
    // Wait for response
    const proxyRes = await new Promise((resolve, reject) => {
      proxyReq.on('response', resolve);
      proxyReq.on('error', reject);
    });
    
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
    
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range, X-Requested-With');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');
    
    // Get content info
    const contentType = proxyRes.headers['content-type'] || '';
    const contentEncoding = proxyRes.headers['content-encoding'];
    const mediaType = getMediaType(contentType);
    
    // Remove security headers
    const removeHeaders = ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options'];
    for (const header of removeHeaders) {
      delete proxyRes.headers[header];
    }
    
    // Forward safe headers
    const forwardHeaders = ['content-type', 'content-length', 'last-modified', 'etag', 'cache-control', 'expires', 'accept-ranges', 'content-range', 'content-disposition'];
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (forwardHeaders.includes(key.toLowerCase()) && value) {
        res.setHeader(key, value);
      }
    }
    
    // Remove content-encoding if we're decompressing
    if (contentEncoding) {
      res.removeHeader('content-encoding');
    }
    
    // Handle cookies
    if (proxyRes.headers['set-cookie']) {
      const cookies = Array.isArray(proxyRes.headers['set-cookie']) 
        ? proxyRes.headers['set-cookie'] 
        : [proxyRes.headers['set-cookie']];
      
      const rewritten = cookies.map(cookie => {
        return cookie
          .replace(/;\s*domain=[^;]+/gi, '')
          .replace(/;\s*path=[^;]+/gi, '; Path=/')
          .replace(/;\s*secure/gi, '')
          .replace(/;\s*samesite=[^;]+/gi, '');
      });
      
      res.setHeader('set-cookie', rewritten);
    }
    
    // Set status
    res.status(proxyRes.statusCode || 200);
    
    // Stream media directly (video, audio, images)
    if (shouldStreamDirectly(contentType)) {
      proxyRes.pipe(res);
      
      const duration = Date.now() - startTime;
      console.log(`[PROXY:${requestId}] ${req.method} ${targetUrl} -> ${proxyRes.statusCode} (${duration}ms) [STREAM]`);
      return;
    }
    
    // For text content, collect, decompress if needed, and rewrite
    const chunks = [];
    const decompress = createDecompressStream(contentEncoding);
    
    if (decompress) {
      proxyRes.pipe(decompress);
      decompress.on('data', chunk => chunks.push(chunk));
    } else {
      proxyRes.on('data', chunk => chunks.push(chunk));
    }
    
    await new Promise(resolve => {
      const endEvent = decompress ? 'end' : 'end';
      (decompress || proxyRes).once(endEvent, resolve);
    });
    
    const responseData = Buffer.concat(chunks);
    
    // Detect charset
    let charset = 'utf-8';
    const charsetMatch = contentType.match(/charset=([^;]+)/i);
    if (charsetMatch) {
      charset = charsetMatch[1].trim();
    }
    
    // Convert to string
    let content;
    try {
      content = iconv.decode(responseData, charset);
    } catch (e) {
      content = responseData.toString('utf-8');
    }
    
    // Rewrite based on type
    try {
      if (mediaType === 'html') {
        content = rewriter.rewriteHtml(content, targetUrl);
      } else if (mediaType === 'css') {
        content = rewriter.rewriteCss(content, targetUrl);
      } else if (mediaType === 'js') {
        content = rewriter.rewriteJs(content, targetUrl);
      }
    } catch (rewriteError) {
      console.error(`[PROXY:${requestId}] Rewrite error:`, rewriteError.message);
      // Continue with original content
    }
    
    // Encode back
    const outputBuffer = iconv.encode(content, 'utf-8');
    res.setHeader('Content-Length', outputBuffer.length);
    res.end(outputBuffer);
    
    const duration = Date.now() - startTime;
    console.log(`[PROXY:${requestId}] ${req.method} ${targetUrl} -> ${proxyRes.statusCode} (${duration}ms)`);
    
  } catch (error) {
    console.error(`[PROXY:${requestId}] Handler error:`, error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Proxy error', details: error.message });
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  proxyHandler,
  rewriteUrl,
  extractUrlFromPath,
  encodeUrl,
  decodeUrl,
  rewriter,
  connectionPool
};
