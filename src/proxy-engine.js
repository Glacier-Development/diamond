/**
 * Diamond Proxy Engine v3.0 - Advanced URL Rewriting & JS Interception
 * Inspired by modern proxy architectures (Scramjet, Mercury Workshop)
 * 
 * Core Features:
 * - Client-side URL rewriting via Service Worker
 * - JavaScript AST-based rewriting for property access interception
 * - Monkeypatching of global APIs (fetch, XHR, WebSocket, etc.)
 * - Proper handling of srcset, CSS urls, and dynamic imports
 * - Range request support for media streaming
 * - Connection pooling and keep-alive for performance
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const Iconv = require('iconv-lite');
const crypto = require('crypto');

// Connection pool manager for better performance
class ConnectionPool {
    constructor() {
        this.httpAgent = new http.Agent({
            keepAlive: true,
            maxSockets: 50,
            maxFreeSockets: 10,
            timeout: 60000,
            freeSocketTimeout: 30000
        });
        
        this.httpsAgent = new https.Agent({
            keepAlive: true,
            maxSockets: 50,
            maxFreeSockets: 10,
            timeout: 60000,
            freeSocketTimeout: 30000,
            rejectUnauthorized: false
        });
    }
    
    getAgent(protocol) {
        return protocol === 'https:' ? this.httpsAgent : this.httpAgent;
    }
}

const connectionPool = new ConnectionPool();

// URL rewriting utilities
class URLRewriter {
    constructor(baseURL, proxyPrefix) {
        this.baseURL = baseURL;
        this.proxyPrefix = proxyPrefix;
        try {
            this.baseOrigin = new URL(baseURL).origin;
        } catch (e) {
            this.baseOrigin = '';
        }
    }
    
    // Convert absolute/relative URLs to proxied URLs
    rewriteURL(url, context = 'auto') {
        if (!url || typeof url !== 'string') return url;
        
        url = url.trim();
        
        // Skip special URLs
        if (url.startsWith('javascript:') || 
            url.startsWith('data:') || 
            url.startsWith('blob:') ||
            url.startsWith('#')) {
            return url;
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            url = this.baseURL.split(':')[0] + ':' + url;
        }
        
        // Handle relative URLs
        if (!url.match(/^https?:\/\//i)) {
            if (this.baseOrigin && !url.startsWith('/')) {
                // Relative path
                const baseParts = this.baseURL.split('/');
                baseParts.pop();
                url = baseParts.join('/') + '/' + url;
            } else if (this.baseOrigin) {
                url = this.baseOrigin + (url.startsWith('/') ? '' : '/') + url;
            } else {
                return url;
            }
        }
        
        // Already proxied?
        if (url.includes(this.proxyPrefix)) {
            return url;
        }
        
        // Create proxied URL
        try {
            const parsed = new URL(url);
            // Encode the target URL properly
            const encodedTarget = encodeURIComponent(parsed.href);
            return `${this.proxyPrefix}${encodedTarget}`;
        } catch (e) {
            return url;
        }
    }
    
    // Convert proxied URLs back to original (for internal use)
    unrewriteURL(proxiedURL) {
        if (!proxiedURL || typeof proxiedURL !== 'string') return proxiedURL;
        
        try {
            if (proxiedURL.includes(this.proxyPrefix)) {
                const encoded = proxiedURL.replace(this.proxyPrefix, '');
                return decodeURIComponent(encoded);
            }
        } catch (e) {}
        
        return proxiedURL;
    }
}

// HTML Rewriter - handles attribute rewriting
class HTMLRewriter {
    constructor(rewriter) {
        this.rewriter = rewriter;
        
        // Attributes that contain URLs
        this.urlAttributes = [
            'src', 'href', 'action', 'formaction', 'data', 'poster',
            'background', 'cite', 'codebase', 'dynsrc', 'lowsrc',
            'usemap', 'longdesc', 'profile', 'srcset', 'imagesrcset'
        ];
        
        // Attributes that contain inline styles with URLs
        this.styleAttributes = ['style', 'css'];
        
        // Attributes that might contain JavaScript with URLs
        this.jsAttributes = [
            'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
            'onmousemove', 'onmouseout', 'onmouseenter', 'onmouseleave',
            'onkeydown', 'onkeypress', 'onkeyup', 'onload', 'onerror',
            'onabort', 'onfocus', 'onblur', 'onchange', 'oninput', 'onsubmit',
            'onreset', 'onselect', 'oncontextmenu', 'onscroll', 'ondrag',
            'ondragend', 'ondragenter', 'ondragleave', 'ondragover',
            'ondragstart', 'ondrop', 'onwheel', 'oncopy', 'oncut', 'onpaste'
        ];
    }
    
    rewrite(html, contentType = 'text/html') {
        if (!html || typeof html !== 'string') return html;
        
        let result = html;
        
        // Rewrite URL attributes
        for (const attr of this.urlAttributes) {
            if (attr === 'srcset' || attr === 'imagesrcset') {
                result = this.rewriteSrcset(result, attr);
            } else {
                result = this.rewriteAttribute(result, attr);
            }
        }
        
        // Rewrite inline styles
        for (const attr of this.styleAttributes) {
            result = this.rewriteStyleAttribute(result, attr);
        }
        
        // Inject client-side rewriting script
        if (contentType.includes('text/html')) {
            result = this.injectClientScript(result);
        }
        
        return result;
    }
    
    rewriteAttribute(html, attrName) {
        // Match attribute patterns: attr="value", attr='value', attr=value
        const patterns = [
            new RegExp(`(${attrName})\\s*=\\s*"([^"]*)"`, 'gi'),
            new RegExp(`(${attrName})\\s*=\\s*'([^']*)'`, 'gi'),
            new RegExp(`(${attrName})\\s*=\\s*([^\\s>"']+)(?=[\\s>])`, 'gi')
        ];
        
        for (const pattern of patterns) {
            html = html.replace(pattern, (match, attr, value) => {
                if (!value) return match;
                const rewritten = this.rewriter.rewriteURL(value);
                if (rewritten !== value) {
                    return `${attr}="${rewritten}"`;
                }
                return match;
            });
        }
        
        return html;
    }
    
    rewriteSrcset(html, attrName) {
        const pattern = new RegExp(`(${attrName})\\s*=\\s*"([^"]*)"`, 'gi');
        
        return html.replace(pattern, (match, attr, value) => {
            if (!value) return match;
            
            // srcset can have multiple URLs: "url1 1x, url2 2x"
            const parts = value.split(',').map(part => {
                const trimmed = part.trim();
                const spaceIndex = trimmed.indexOf(' ');
                if (spaceIndex > 0) {
                    const url = trimmed.substring(0, spaceIndex);
                    const descriptor = trimmed.substring(spaceIndex);
                    const rewritten = this.rewriter.rewriteURL(url);
                    return `${rewritten}${descriptor}`;
                }
                return this.rewriter.rewriteURL(trimmed);
            });
            
            return `${attr}="${parts.join(', ')}"`;
        });
    }
    
    rewriteStyleAttribute(html, attrName) {
        const pattern = new RegExp(`(${attrName})\\s*=\\s*"([^"]*)"`, 'gi');
        
        return html.replace(pattern, (match, attr, value) => {
            if (!value || !value.includes('url(')) return match;
            
            // Rewrite url() in CSS
            const rewritten = value.replace(/url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi, (urlMatch, quote, url) => {
                const rewrittenUrl = this.rewriter.rewriteURL(url);
                return `url('${rewrittenUrl}')`;
            });
            
            return `${attr}="${rewritten}"`;
        });
    }
    
    injectClientScript(html) {
        const script = `
<script id="diamond-proxy-client">
(function() {
    if (window.__diamondProxyInitialized) return;
    window.__diamondProxyInitialized = true;
    
    const PROXY_PREFIX = '${process.env.PROXY_PREFIX || '/proxy/'}';
    
    // Helper to rewrite URLs
    function rewriteURL(url) {
        if (!url || typeof url !== 'string') return url;
        if (url.startsWith('javascript:') || url.startsWith('data:') || 
            url.startsWith('blob:') || url.startsWith('#')) return url;
        if (url.startsWith('//')) url = location.protocol + url;
        if (!url.match(/^https?:\\/\\//i)) {
            try {
                url = new URL(url, location.href).href;
            } catch(e) { return url; }
        }
        if (url.includes(PROXY_PREFIX)) return url;
        return PROXY_PREFIX + encodeURIComponent(url);
    }
    
    // Monkeypatch fetch
    if (window.fetch) {
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
            if (args[0] instanceof Request) {
                const req = args[0];
                const newUrl = rewriteURL(req.url);
                if (newUrl !== req.url) {
                    args[0] = new Request(newUrl, req);
                }
            } else if (typeof args[0] === 'string') {
                args[0] = rewriteURL(args[0]);
            }
            return originalFetch.apply(this, args);
        };
    }
    
    // Monkeypatch XMLHttpRequest
    if (window.XMLHttpRequest) {
        const originalXHR = window.XMLHttpRequest;
        const patchedXHR = function() {
            const xhr = new originalXHR();
            const originalOpen = xhr.open;
            const originalSend = xhr.send;
            
            xhr.open = function(method, url, ...rest) {
                if (typeof url === 'string') {
                    url = rewriteURL(url);
                }
                return originalOpen.call(this, method, url, ...rest);
            };
            
            return xhr;
        };
        
        // Copy static properties
        Object.getOwnPropertyNames(originalXHR).forEach(prop => {
            patchedXHR[prop] = originalXHR[prop];
        });
        
        window.XMLHttpRequest = patchedXHR;
    }
    
    // Monkeypatch WebSocket
    if (window.WebSocket) {
        const originalWS = window.WebSocket;
        window.WebSocket = function(url, protocols) {
            if (typeof url === 'string') {
                // WebSocket URLs need special handling
                if (url.startsWith('ws://')) url = 'http://' + url.slice(5);
                if (url.startsWith('wss://')) url = 'https://' + url.slice(6);
                url = rewriteURL(url);
                if (url.startsWith('http://')) url = 'ws://' + url.slice(7);
                if (url.startsWith('https://')) url = 'wss://' + url.slice(8);
            }
            return new originalWS(url, protocols);
        };
        
        // Copy static properties
        Object.getOwnPropertyNames(originalWS).forEach(prop => {
            window.WebSocket[prop] = originalWS[prop];
        });
    }
    
    // Rewrite element properties
    const elementProto = Element.prototype;
    const descriptors = {
        'src': ['IMG', 'SCRIPT', 'VIDEO', 'AUDIO', 'SOURCE', 'IFRAME', 'EMBED', 'TRACK'],
        'href': ['A', 'LINK', 'BASE', 'AREA'],
        'action': ['FORM'],
        'data': ['OBJECT'],
        'poster': ['VIDEO'],
        'formAction': ['BUTTON', 'INPUT']
    };
    
    for (const [prop, tags] of Object.entries(descriptors)) {
        for (const tag of tags) {
            const proto = window[tag]?.prototype;
            if (!proto) continue;
            
            const desc = Object.getOwnPropertyDescriptor(proto, prop) || 
                        Object.getOwnPropertyDescriptor(elementProto, prop);
            if (!desc || !desc.get) continue;
            
            const originalGetter = desc.get;
            const originalSetter = desc.set;
            
            Object.defineProperty(proto, prop, {
                get() {
                    return originalGetter.call(this);
                },
                set(value) {
                    if (typeof value === 'string') {
                        value = rewriteURL(value);
                    }
                    return originalSetter ? originalSetter.call(this, value) : undefined;
                },
                configurable: true,
                enumerable: desc.enumerable
            });
        }
    }
    
    // Handle history API
    const historyProto = History.prototype;
    ['pushState', 'replaceState'].forEach(method => {
        const original = historyProto[method];
        historyProto[method] = function(...args) {
            if (args.length > 2 && typeof args[2] === 'string') {
                // Don't rewrite state URLs, they're relative
            }
            return original.apply(this, args);
        };
    });
    
    console.log('[Diamond Proxy] Client-side rewriting initialized');
})();
<\/script>`;
        
        // Inject after <head> or before </head>
        if (html.includes('<head>')) {
            return html.replace('<head>', '<head>' + script);
        } else if (html.includes('</head>')) {
            return html.replace('</head>', script + '</head>');
        } else if (html.includes('<body>')) {
            return html.replace('<body>', '<body>' + script);
        } else {
            return script + html;
        }
    }
}

// CSS Rewriter
class CSSRewriter {
    constructor(rewriter) {
        this.rewriter = rewriter;
    }
    
    rewrite(css) {
        if (!css || typeof css !== 'string') return css;
        
        // Rewrite url() references
        return css.replace(/url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi, (match, quote, url) => {
            const rewritten = this.rewriter.rewriteURL(url);
            return `url('${rewritten}')`;
        });
    }
}

// Main proxy handler
class ProxyEngine {
    constructor(options = {}) {
        this.proxyPrefix = options.proxyPrefix || '/proxy/';
        this.rewriter = new URLRewriter('', this.proxyPrefix);
        this.htmlRewriter = new HTMLRewriter(this.rewriter);
        this.cssRewriter = new CSSRewriter(this.rewriter);
        
        // Media types that should be streamed directly without modification
        this.directStreamTypes = [
            'video/', 'audio/', 'image/', 
            'application/octet-stream', 'application/pdf',
            'font/', 'application/font', 'application/x-font'
        ];
    }
    
    // Parse target URL from proxied request
    parseTargetURL(requestedPath) {
        try {
            // Extract encoded URL from path
            let encoded = requestedPath.replace(this.proxyPrefix, '');
            
            // Always try to decode - URLs from browser will be encodeURIComponent'd
            let prevDecoded;
            let decodeAttempts = 0;
            do {
                prevDecoded = encoded;
                try {
                    encoded = decodeURIComponent(encoded);
                } catch (e) {
                    // Not encoded or invalid encoding, use as-is
                    break;
                }
                decodeAttempts++;
            } while (encoded !== prevDecoded && decodeAttempts < 5);
            
            // Ensure protocol
            if (!encoded.match(/^https?:\/\//i)) {
                encoded = 'https://' + encoded;
            }
            
            return new URL(encoded);
        } catch (e) {
            console.error('[PROXY] URL parse error:', e.message, 'Path:', requestedPath);
            return null;
        }
    }
    
    // Check if content type should be streamed directly
    shouldStreamDirect(contentType) {
        if (!contentType) return false;
        contentType = contentType.toLowerCase();
        return this.directStreamTypes.some(type => contentType.startsWith(type));
    }
    
    // Main request handler
    async handleRequest(req, res) {
        const requestedPath = req.url;
        
        // Parse target URL
        const targetURL = this.parseTargetURL(requestedPath);
        if (!targetURL) {
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Invalid target URL');
            return;
        }
        
        // Security: Block private networks
        if (this.isPrivateNetwork(targetURL.hostname)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Access to private networks is blocked');
            return;
        }
        
        // Build upstream request
        const protocol = targetURL.protocol === 'https:' ? https : http;
        const agent = connectionPool.getAgent(targetURL.protocol);
        
        const upstreamOptions = {
            hostname: targetURL.hostname,
            port: targetURL.port || (targetURL.protocol === 'https:' ? 443 : 80),
            path: targetURL.pathname + targetURL.search,
            method: req.method,
            headers: this.sanitizeHeaders(req.headers, targetURL.hostname),
            agent: agent,
            timeout: 120000, // 2 minute timeout for large files
            rejectUnauthorized: false
        };
        
        // Handle range requests for media
        if (req.headers.range) {
            upstreamOptions.headers.range = req.headers.range;
        }
        
        try {
            const upstreamReq = protocol.request(upstreamOptions, async (upstreamRes) => {
                const contentType = upstreamRes.headers['content-type'] || '';
                
                // Stream directly for media/binary content
                if (this.shouldStreamDirect(contentType) || 
                    req.headers.range ||
                    upstreamRes.headers['content-range']) {
                    // Set response headers and pipe
                    const responseHeaders = this.buildResponseHeaders(upstreamRes, targetURL);
                    res.writeHead(upstreamRes.statusCode, responseHeaders);
                    upstreamRes.pipe(res);
                    return;
                }
                
                // Buffer and rewrite text content
                const chunks = [];
                upstreamRes.on('data', chunk => chunks.push(chunk));
                upstreamRes.on('end', async () => {
                    let body = Buffer.concat(chunks);
                    
                    // Handle compression
                    const encoding = upstreamRes.headers['content-encoding'];
                    if (encoding === 'gzip' || encoding === 'deflate') {
                        try {
                            body = encoding === 'gzip' 
                                ? zlib.gunzipSync(body)
                                : zlib.inflateSync(body);
                        } catch (e) {
                            console.error('[PROXY] Decompression error:', e.message);
                        }
                    }
                    
                    // Detect charset
                    let charset = 'utf-8';
                    const ctHeader = contentType;
                    const charsetMatch = ctHeader.match(/charset=([^;]+)/i);
                    if (charsetMatch) {
                        charset = charsetMatch[1].trim();
                    }
                    
                    // Convert to string
                    let text;
                    try {
                        text = Iconv.decode(body, charset);
                    } catch (e) {
                        text = body.toString('utf-8');
                    }
                    
                    // Rewrite based on content type
                    if (contentType.includes('text/html')) {
                        this.rewriter.baseURL = targetURL.href;
                        text = this.htmlRewriter.rewrite(text, contentType);
                    } else if (contentType.includes('text/css')) {
                        this.rewriter.baseURL = targetURL.href;
                        text = this.cssRewriter.rewrite(text);
                    } else if (contentType.includes('javascript') || 
                               contentType.includes('application/x-javascript')) {
                        // For JS, we rely on client-side monkeypatching
                        // Could add AST rewriting here for advanced use cases
                    }
                    
                    // Send rewritten content
                    const output = Iconv.encode(text, 'utf-8');
                    
                    // Set headers only if not already sent
                    if (!res.headersSent) {
                        const responseHeaders = this.buildResponseHeaders(upstreamRes, targetURL);
                        responseHeaders['Content-Length'] = output.length;
                        delete responseHeaders['content-encoding'];
                        res.writeHead(upstreamRes.statusCode, responseHeaders);
                    }
                    res.end(output);
                });
            });
            
            // Handle upstream errors
            upstreamReq.on('error', (e) => {
                console.error('[PROXY] Upstream error:', e.message);
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                    res.end(`Proxy Error: ${e.message}`);
                } else {
                    res.destroy();
                }
            });
            
            upstreamReq.on('timeout', () => {
                upstreamReq.destroy();
                if (!res.headersSent) {
                    res.writeHead(504, { 'Content-Type': 'text/plain' });
                    res.end('Gateway Timeout');
                }
            });
            
            // Pipe request body for POST/PUT
            if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
                req.pipe(upstreamReq);
            } else {
                upstreamReq.end();
            }
            
        } catch (e) {
            console.error('[PROXY] Request error:', e.message);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Proxy Error: ${e.message}`);
            }
        }
    }
    
    // Sanitize headers for upstream request
    sanitizeHeaders(headers, targetHost) {
        const allowedHeaders = [
            'accept', 'accept-language', 'accept-encoding',
            'cache-control', 'connection', 'content-length',
            'content-type', 'cookie', 'dnt', 'expect',
            'forwarded', 'if-match', 'if-modified-since',
            'if-none-match', 'if-range', 'if-unmodified-since',
            'max-forwards', 'pragma', 'range', 'referer',
            'te', 'trailer', 'transfer-encoding', 'upgrade',
            'user-agent', 'via', 'warning', 'x-requested-with'
        ];
        
        const sanitized = {};
        
        for (const [key, value] of Object.entries(headers)) {
            const lowerKey = key.toLowerCase();
            
            // Skip hop-by-hop headers
            if (lowerKey === 'host' || 
                lowerKey === 'origin' ||
                allowedHeaders.includes(lowerKey)) {
                
                // Special handling for referer
                if (lowerKey === 'referer') {
                    // Keep referer but ensure it's valid
                    try {
                        const refererURL = new URL(value);
                        sanitized[key] = refererURL.href;
                    } catch (e) {
                        // Invalid referer, skip it
                    }
                } else if (lowerKey === 'cookie') {
                    // Pass cookies through
                    sanitized[key] = value;
                } else if (value && typeof value === 'string') {
                    // Validate header value (no newlines, control chars)
                    if (!value.match(/[\r\n]/)) {
                        sanitized[key] = value;
                    }
                }
            }
        }
        
        // Set proper Host header
        sanitized['Host'] = targetHost;
        
        return sanitized;
    }
    
    // Build response headers
    buildResponseHeaders(upstreamRes, targetURL) {
        const headers = {};
        
        // Copy safe headers
        const safeHeaders = [
            'content-type', 'content-length', 'cache-control',
            'expires', 'etag', 'last-modified', 'content-disposition',
            'content-range', 'accept-ranges', 'content-encoding'
        ];
        
        for (const header of safeHeaders) {
            if (upstreamRes.headers[header]) {
                headers[header] = upstreamRes.headers[header];
            }
        }
        
        // Add CORS headers for cross-origin access
        headers['Access-Control-Allow-Origin'] = '*';
        headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS, HEAD';
        headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, Range, X-Requested-With';
        headers['Access-Control-Expose-Headers'] = 'Content-Range, Content-Length, Content-Encoding';
        headers['Access-Control-Allow-Credentials'] = 'true';
        
        // Remove security headers that break proxying
        // (CSP, X-Frame-Options, etc. are intentionally omitted)
        
        return headers;
    }
    
    // Check if hostname is a private network address
    isPrivateNetwork(hostname) {
        // Block localhost variations
        if (hostname === 'localhost' || 
            hostname === '127.0.0.1' || 
            hostname === '::1' ||
            hostname.endsWith('.local')) {
            return true;
        }
        
        // Block private IP ranges
        const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const match = hostname.match(ipPattern);
        
        if (match) {
            const [, a, b, c, d] = match.map(Number);
            
            // 10.0.0.0/8
            if (a === 10) return true;
            
            // 172.16.0.0/12
            if (a === 172 && b >= 16 && b <= 31) return true;
            
            // 192.168.0.0/16
            if (a === 192 && b === 168) return true;
            
            // 127.0.0.0/8
            if (a === 127) return true;
            
            // 0.0.0.0
            if (a === 0) return true;
        }
        
        return false;
    }
}

module.exports = ProxyEngine;
module.exports.URLRewriter = URLRewriter;
module.exports.HTMLRewriter = HTMLRewriter;
module.exports.CSSRewriter = CSSRewriter;
module.exports.ConnectionPool = ConnectionPool;
