const http = require('http');
const https = require('https');
const { URL } = require('url');

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
function rewriteUrl(url) {
  // Handle URLs that are already proxied
  if (url.startsWith('/proxy/')) {
    return url;
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
 * Main proxy handler middleware
 * Intercepts requests and forwards them to target servers
 */
async function proxyHandler(req, res) {
  try {
    // Extract the target URL from the request path
    let targetUrl;
    try {
      targetUrl = extractUrl(req.path);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid proxy URL' });
    }
    
    // Validate URL scheme (only allow http/https)
    const parsedUrl = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(403).json({ error: 'Protocol not allowed' });
    }
    
    // Build request options
    const isHttps = parsedUrl.protocol === 'https:';
    const agent = isHttps ? https.globalAgent : http.globalAgent;
    
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: req.method,
      headers: {},
      agent: agent,
      timeout: 30000, // 30 second timeout
    };
    
    // Copy relevant headers from original request (only safe ones)
    const allowedHeaders = ['accept', 'accept-language', 'content-type', 'authorization'];
    for (const header of allowedHeaders) {
      if (req.headers[header]) {
        requestOptions.headers[header] = req.headers[header];
      }
    }
    
    // Set essential headers
    requestOptions.headers.host = parsedUrl.host;
    requestOptions.headers['user-agent'] = req.headers['user-agent'] || 'Diamond-Proxy/1.0';
    
    // Handle request body for POST/PUT/PATCH
    let requestBody = null;
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        requestBody = Buffer.concat(chunks);
        if (requestBody.length > 0) {
          requestOptions.headers['content-length'] = requestBody.length;
        }
      });
    }
    
    // Make the proxied request
    const client = isHttps ? https : http;
    const proxyReq = client.request(requestOptions, async (proxyRes) => {
      // Set response headers (filter out dangerous ones)
      const blockedHeaders = ['set-cookie', 'content-encoding', 'transfer-encoding', 'strict-transport-security'];
      
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (!blockedHeaders.includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      }
      
      // Allow cookies but rewrite domains (simplified - production would need full cookie rewriting)
      if (proxyRes.headers['set-cookie']) {
        const cookies = Array.isArray(proxyRes.headers['set-cookie']) 
          ? proxyRes.headers['set-cookie'] 
          : [proxyRes.headers['set-cookie']];
        
        // Rewrite cookie domains to current host
        const rewrittenCookies = cookies.map(cookie => {
          return cookie.replace(/domain=[^;]+/i, '');
        });
        res.setHeader('set-cookie', rewrittenCookies);
      }
      
      // Set CORS headers to allow cross-origin requests from proxied content
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      
      // Send response status
      res.status(proxyRes.statusCode || 200);
      
      // Pipe response data
      proxyRes.pipe(res);
    });
    
    // Handle proxy request errors
    proxyReq.on('error', (err) => {
      console.error('[PROXY ERROR]', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to connect to target server', details: err.message });
      }
    });
    
    // Handle timeout
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request timeout' });
      }
    });
    
    // Send request body if present
    if (requestBody) {
      proxyReq.write(requestBody);
    }
    
    proxyReq.end();
    
  } catch (error) {
    console.error('[PROXY HANDLER ERROR]', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Proxy error', details: error.message });
    }
  }
}

module.exports = {
  proxyHandler,
  rewriteUrl,
  extractUrl,
  encodeUrl,
  decodeUrl
};
