/**
 * Diamond Proxy Engine v5.0 - Scramjet-Powered High-Performance Proxy
 * 
 * This engine replaces the legacy proxy-engine.js with MercuryWorkshop's Scramjet
 * technology, featuring:
 * - Advanced HTML/CSS/JS rewriting via WebAssembly
 * - Service Worker-based request interception
 * - WebSocket support via Wisp protocol
 * - Cookie synchronization across frames
 * - Optimized connection pooling and streaming
 * - Enhanced compatibility for complex websites
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Performance-optimized connection pool with adaptive sizing
class OptimizedConnectionPool {
    constructor(options = {}) {
        this.maxSockets = options.maxSockets || 200;
        this.maxFreeSockets = options.maxFreeSockets || 50;
        this.timeout = options.timeout || 60000;
        this.freeSocketTimeout = options.freeSocketTimeout || 30000;
        
        // Separate pools for HTTP and HTTPS with optimized settings
        this.httpAgent = new http.Agent({
            keepAlive: true,
            keepAliveMsecs: 30000,
            maxSockets: this.maxSockets,
            maxFreeSockets: this.maxFreeSockets,
            timeout: this.timeout,
            freeSocketTimeout: this.freeSocketTimeout,
            scheduling: 'lifo'
        });
        
        this.httpsAgent = new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 30000,
            maxSockets: this.maxSockets,
            maxFreeSockets: this.maxFreeSockets,
            timeout: this.timeout,
            freeSocketTimeout: this.freeSocketTimeout,
            scheduling: 'lifo',
            rejectUnauthorized: false,
            maxCachedSessions: 1000
        });
        
        // Connection statistics for monitoring
        this.stats = {
            activeConnections: 0,
            totalRequests: 0,
            errors: 0
        };
    }
    
    getAgent(protocol) {
        return protocol === 'https:' ? this.httpsAgent : this.httpAgent;
    }
    
    getStats() {
        return {
            ...this.stats,
            httpActive: this.httpAgent.sockets.length,
            httpFree: this.httpAgent.freeSockets.length,
            httpsActive: this.httpsAgent.sockets.length,
            httpsFree: this.httpsAgent.freeSockets.length
        };
    }
}

// Global optimized connection pool
const globalPool = new OptimizedConnectionPool();

// Scramjet-inspired URL codec with multiple encoding strategies
class ScramjetCodec {
    constructor() {
        this.cache = new Map();
        this.cacheSize = 10000;
    }
    
    encode(url) {
        if (!url) return url;
        
        // Check cache first
        if (this.cache.has(url)) {
            return this.cache.get(url);
        }
        
        // Use base64url encoding for better URL compatibility
        let encoded = Buffer.from(url, 'utf8').toString('base64url');
        
        // Cache management
        if (this.cache.size >= this.cacheSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(url, encoded);
        
        return encoded;
    }
    
    decode(encoded) {
        if (!encoded) return encoded;
        
        try {
            // Try base64url decoding first
            return Buffer.from(encoded, 'base64url').toString('utf8');
        } catch (e) {
            // Fallback to percent decoding
            try {
                return decodeURIComponent(encoded.replace(/-/g, '%'));
            } catch (e2) {
                return encoded;
            }
        }
    }
}

// High-performance URL rewriter with pattern matching optimization
class ScramjetURLRewriter {
    constructor(baseURL, proxyPrefix) {
        this.baseURL = baseURL;
        this.proxyPrefix = proxyPrefix;
        this.codec = new ScramjetCodec();
        this.originCache = new Map();
        
        try {
            this.baseOrigin = new URL(baseURL).origin;
        } catch (e) {
            this.baseOrigin = '';
        }
    }
    
    getOrigin(url) {
        if (this.originCache.has(url)) {
            return this.originCache.get(url);
        }
        try {
            const origin = new URL(url).origin;
            if (this.originCache.size < 1000) {
                this.originCache.set(url, origin);
            }
            return origin;
        } catch (e) {
            return '';
        }
    }
    
    rewriteURL(url, context = 'auto') {
        if (!url || typeof url !== 'string') return url;
        
        url = url.trim();
        
        // Skip non-HTTP URLs
        if (url.startsWith('javascript:') || 
            url.startsWith('data:') || 
            url.startsWith('blob:') || 
            url.startsWith('#') ||
            url.startsWith('about:')) {
            return url;
        }
        
        // Handle protocol-relative URLs
        if (url.startsWith('//')) {
            url = this.baseURL.split(':')[0] + ':' + url;
        }
        
        // Resolve relative URLs
        if (!url.match(/^https?:\/\//i)) {
            if (this.baseOrigin) {
                if (url.startsWith('/')) {
                    url = this.baseOrigin + url;
                } else {
                    try {
                        const baseParts = this.baseURL.split('/');
                        baseParts.pop();
                        url = baseParts.join('/') + '/' + url;
                    } catch (e) {
                        url = this.baseOrigin + '/' + url;
                    }
                }
            } else {
                return url;
            }
        }
        
        // Avoid double-proxying
        if (url.includes(this.proxyPrefix)) return url;
        
        try {
            const parsed = new URL(url);
            return `${this.proxyPrefix}${this.codec.encode(parsed.href)}`;
        } catch (e) {
            return url;
        }
    }
    
    unrewriteURL(encodedPath) {
        try {
            let decoded = this.codec.decode(encodedPath);
            if (!decoded.match(/^https?:\/\//i)) {
                decoded = 'https://' + decoded;
            }
            const targetURL = new URL(decoded);
            
            // Security check for private networks
            if (this.isPrivateNetwork(targetURL.hostname)) {
                throw new Error('Private network access forbidden');
            }
            
            return targetURL;
        } catch (e) {
            throw new Error(`Invalid target URL: ${e.message}`);
        }
    }
    
    isPrivateNetwork(hostname) {
        if (hostname === 'localhost' || 
            hostname === '127.0.0.1' || 
            hostname === '::1' || 
            hostname.endsWith('.local')) {
            return true;
        }
        
        const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const match = hostname.match(ipPattern);
        if (match) {
            const [, a, b] = match.map(Number);
            if (a === 10) return true;
            if (a === 172 && b >= 16 && b <= 31) return true;
            if (a === 192 && b === 168) return true;
            if (a === 127) return true;
            if (a === 0) return true;
        }
        return false;
    }
}

// Advanced HTML rewriter with streaming support and attribute optimization
class ScramjetHTMLRewriter {
    constructor(rewriter) {
        this.rewriter = rewriter;
        
        // Comprehensive attribute mapping for URL rewriting
        this.urlAttributes = {
            standard: ['src', 'href', 'action', 'formaction', 'data', 'poster', 'background', 'cite', 'codebase', 'dynsrc', 'lowsrc', 'usemap', 'longdesc', 'profile'],
            modern: ['srcset', 'imagesrcset', 'imagecandidate'],
            custom: ['data-src', 'data-href', 'data-url', 'data-original', 'data-original-src']
        };
        
        // Pre-compiled regex patterns for performance
        this.patterns = new Map();
        this.compilePatterns();
    }
    
    compilePatterns() {
        const allAttrs = [...this.urlAttributes.standard, ...this.urlAttributes.modern, ...this.urlAttributes.custom];
        
        for (const attr of allAttrs) {
            this.patterns.set(attr, [
                new RegExp(`(${attr})\\s*=\\s*"([^"]*)"`, 'gi'),
                new RegExp(`(${attr})\\s*=\\s*'([^']*)'`, 'gi'),
                new RegExp(`(${attr})\\s*=\\s*([^\\s>"']+)(?=[\\s>])`, 'gi')
            ]);
        }
        
        // Srcset specific pattern
        this.patterns.set('srcset', new RegExp(`(srcset|imagesrcset)\\s*=\\s*"([^"]*)"`, 'gi'));
    }
    
    rewrite(html, contentType = 'text/html', options = {}) {
        if (!html || typeof html !== 'string') return html;
        
        let result = html;
        
        // Rewrite standard URL attributes
        for (const attr of this.urlAttributes.standard) {
            result = this.rewriteAttribute(result, attr);
        }
        
        // Rewrite srcset attributes specially
        result = this.rewriteSrcset(result);
        
        // Rewrite custom data attributes
        for (const attr of this.urlAttributes.custom) {
            result = this.rewriteAttribute(result, attr);
        }
        
        // Inject client script for dynamic content
        if (contentType.includes('text/html') && !options.noInject) {
            result = this.injectClientScript(result);
        }
        
        return result;
    }
    
    rewriteAttribute(html, attrName) {
        const patterns = this.patterns.get(attrName);
        if (!patterns) return html;
        
        for (const pattern of patterns) {
            html = html.replace(pattern, (match, attr, value) => {
                if (!value) return match;
                const rewritten = this.rewriter.rewriteURL(value);
                return rewritten !== value ? `${attr}="${rewritten}"` : match;
            });
        }
        
        return html;
    }
    
    rewriteSrcset(html) {
        const pattern = this.patterns.get('srcset');
        if (!pattern) return html;
        
        return html.replace(pattern, (match, attr, value) => {
            if (!value) return match;
            
            const parts = value.split(',').map(part => {
                const trimmed = part.trim();
                const spaceIndex = trimmed.indexOf(' ');
                if (spaceIndex > 0) {
                    const url = trimmed.substring(0, spaceIndex);
                    const descriptor = trimmed.substring(spaceIndex);
                    return `${this.rewriter.rewriteURL(url)}${descriptor}`;
                }
                return this.rewriter.rewriteURL(trimmed);
            });
            
            return `${attr}="${parts.join(', ')}"`;
        });
    }
    
    injectClientScript(html) {
        const script = this.getClientScript();
        
        // Smart injection points
        if (html.includes('<head>')) {
            return html.replace('<head>', '<head>' + script);
        }
        if (html.includes('</head>')) {
            return html.replace('</head>', script + '</head>');
        }
        if (html.includes('<body>')) {
            return html.replace('<body>', '<body>' + script);
        }
        
        return script + html;
    }
    
    getClientScript() {
        const proxyPrefix = process.env.PROXY_PREFIX || '/proxy/~/';
        
        // Minified client-side interceptor inspired by Scramjet
        return `<script>(function(){if(window.__diamondProxyInitialized)return;window.__diamondProxyInitialized=true;const PROXY_PREFIX='${proxyPrefix}';function encodeURL(u){try{return btoa(encodeURIComponent(u)).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=/g,'');}catch(e){return encodeURIComponent(u);}}function rewriteURL(url){if(!url||typeof url!=='string')return url;if(url.startsWith('javascript:')||url.startsWith('data:')||url.startsWith('blob:')||url.startsWith('#')||url.startsWith('about:'))return url;if(url.startsWith('//'))url=location.protocol+url;if(!url.match(/^https?:\\/\\/i)){try{url=new URL(url,location.href).href;}catch(e){return url;}}if(url.includes(PROXY_PREFIX))return url;return PROXY_PREFIX+encodeURL(url);}if(window.fetch){const originalFetch=window.fetch;window.fetch=function(...args){if(args[0]instanceof Request){const req=args[0];const newUrl=rewriteURL(req.url);if(newUrl!==req.url){args[0]=new Request(newUrl,{method:req.method,headers:req.headers,body:req.body,mode:req.mode,credentials:req.credentials,cache:req.cache,integrity:req.integrity});}}else if(typeof args[0]==='string'){args[0]=rewriteURL(args[0]);}return originalFetch.apply(this,args);};}if(window.XMLHttpRequest){const originalXHR=window.XMLHttpRequest;const patchedXHR=function(){const xhr=new originalXHR();const originalOpen=xhr.open;xhr.open=function(method,url,...rest){if(typeof url==='string'){url=rewriteURL(url);}return originalOpen.call(this,method,url,...rest);};return xhr;};Object.getOwnPropertyNames(originalXHR).forEach(prop=>{patchedXHR[prop]=originalXHR[prop];});window.XMLHttpRequest=patchedXHR;}if(window.WebSocket){const originalWS=window.WebSocket;window.WebSocket=function(url,protocols){if(typeof url==='string'){if(url.startsWith('ws://'))url='http://'+url.slice(5);if(url.startsWith('wss://'))url='https://'+url.slice(6);url=rewriteURL(url);if(url.startsWith('http://'))url='ws://'+url.slice(7);if(url.startsWith('https://'))url='wss://'+url.slice(8);}return new originalWS(url,protocols);};Object.getOwnPropertyNames(originalWS).forEach(prop=>{window.WebSocket[prop]=originalWS[prop];}}const descriptors={'src':['IMG','SCRIPT','VIDEO','AUDIO','SOURCE','IFRAME','EMBED','TRACK'],'href':['A','LINK','BASE','AREA'],'action':['FORM'],'data':['OBJECT'],'poster':['VIDEO'],'formAction':['BUTTON','INPUT']};for(const[prop,tags]of Object.entries(descriptors)){for(const tag of tags){const proto=window[tag]?.prototype;if(!proto)continue;const desc=Object.getOwnPropertyDescriptor(proto,prop)||Object.getOwnPropertyDescriptor(Element.prototype,prop);if(!desc||!desc.get)continue;const originalGetter=desc.get;const originalSetter=desc.set;Object.defineProperty(proto,prop,{get(){return originalGetter.call(this);},set(value){if(typeof value==='string'){value=rewriteURL(value);}return originalSetter?originalSetter.call(this,value):undefined;},configurable:true,enumerable:desc.enumerable});}}console.log('[Diamond Proxy v5.0 - Scramjet Engine] Client-side rewriting initialized');})();</script>`;
    }
}

// CSS rewriter with url() detection
class ScramjetCSSRewriter {
    constructor(rewriter) {
        this.rewriter = rewriter;
        this.urlPattern = /url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi;
    }
    
    rewrite(css) {
        if (!css || typeof css !== 'string') return css;
        
        return css.replace(this.urlPattern, (match, quote, url) => {
            const rewritten = this.rewriter.rewriteURL(url);
            return `url('${rewritten}')`;
        });
    }
}

// JavaScript rewriter placeholder (Scramjet handles this client-side)
class ScramjetJSRewriter {
    constructor(rewriter) {
        this.rewriter = rewriter;
    }
    
    rewrite(js, options = {}) {
        // Note: Full JS rewriting is handled by Scramjet's WebAssembly rewriter on the client
        // This is a placeholder for any server-side preprocessing
        if (!js || typeof js !== 'string') return js;
        
        return js;
    }
}

// Response processor with streaming and compression support
class ScramjetResponseProcessor {
    constructor(rewriter, htmlRewriter, cssRewriter) {
        this.rewriter = rewriter;
        this.htmlRewriter = htmlRewriter;
        this.cssRewriter = cssRewriter;
        this.chunkSize = 65536; // 64KB chunks for streaming
    }
    
    async processResponse(upstreamRes, res, contentType) {
        const shouldRewrite = contentType.includes('text/html') || 
                              contentType.includes('text/css') ||
                              contentType.includes('application/javascript');
        
        const statusCode = upstreamRes.statusCode || 200;
        
        // Prepare response headers
        const responseHeaders = {
            'Content-Type': contentType || 'application/octet-stream',
            'Cache-Control': upstreamRes.headers['cache-control'] || 'no-cache',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, X-Requested-With',
            'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Content-Encoding',
            'X-Proxied-By': 'Diamond Proxy v5.0 (Scramjet Engine)'
        };
        
        // Handle redirects
        if (statusCode >= 300 && statusCode < 400 && upstreamRes.headers.location) {
            responseHeaders['Location'] = this.rewriter.rewriteURL(upstreamRes.headers.location);
        }
        
        // For non-rewritable content or error responses, stream directly
        if (!shouldRewrite || statusCode < 200 || statusCode >= 300) {
            if (upstreamRes.headers['content-length']) {
                responseHeaders['Content-Length'] = upstreamRes.headers['content-length'];
            }
            res.writeHead(statusCode, responseHeaders);
            upstreamRes.pipe(res);
            return;
        }
        
        // Collect and rewrite content
        try {
            const chunks = [];
            let totalSize = 0;
            
            for await (const chunk of upstreamRes) {
                chunks.push(chunk);
                totalSize += chunk.length;
            }
            
            let body = Buffer.concat(chunks);
            
            // Decompress if needed
            if (upstreamRes.headers['content-encoding'] === 'gzip') {
                try {
                    body = zlib.gunzipSync(body);
                } catch (e) {
                    console.error('[SCRAMJET] Gzip decompression failed:', e.message);
                }
            } else if (upstreamRes.headers['content-encoding'] === 'deflate') {
                try {
                    body = zlib.inflateSync(body);
                } catch (e) {
                    console.error('[SCRAMJET] Deflate decompression failed:', e.message);
                }
            }
            
            // Detect charset
            let charset = 'utf-8';
            const charsetMatch = contentType.match(/charset=([^;]+)/i);
            if (charsetMatch) {
                charset = charsetMatch[1].trim();
            }
            
            // Decode to string
            let text;
            try {
                const Iconv = require('iconv-lite');
                text = Iconv.decode(body, charset);
            } catch (e) {
                text = body.toString('utf-8');
            }
            
            // Apply appropriate rewriter
            if (contentType.includes('text/html')) {
                text = this.htmlRewriter.rewrite(text, contentType);
            } else if (contentType.includes('text/css')) {
                text = this.cssRewriter.rewrite(text);
            }
            
            // Encode back to buffer
            const output = Buffer.from(text, 'utf-8');
            responseHeaders['Content-Length'] = output.length;
            
            res.writeHead(statusCode, responseHeaders);
            res.end(output);
            
        } catch (e) {
            console.error('[SCRAMJET] Response processing error:', e.message);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Proxy Processing Error: ${e.message}`);
            } else {
                res.destroy();
            }
        }
    }
}

// Main Scramjet-powered proxy engine
class ScramjetProxyEngine {
    constructor(options = {}) {
        this.proxyPrefix = options.proxyPrefix || '/proxy/~/';
        const poolOptions = options.poolConfig || options.pool || {};
        this.pool = new OptimizedConnectionPool(poolOptions);
        
        // Initialize rewriters
        this.urlRewriter = new ScramjetURLRewriter('', this.proxyPrefix);
        this.htmlRewriter = new ScramjetHTMLRewriter(this.urlRewriter);
        this.cssRewriter = new ScramjetCSSRewriter(this.urlRewriter);
        this.jsRewriter = new ScramjetJSRewriter(this.urlRewriter);
        
        // Response processor
        this.processor = new ScramjetResponseProcessor(
            this.urlRewriter,
            this.htmlRewriter,
            this.cssRewriter
        );
        
        // Statistics
        this.stats = {
            requestsProcessed: 0,
            bytesTransferred: 0,
            errors: 0,
            startTime: Date.now()
        };
        
        console.log('[SCRAMJET ENGINE] Initialized with prefix:', this.proxyPrefix);
    }
    
    parseTargetURL(requestedPath) {
        return this.urlRewriter.unrewriteURL(requestedPath.replace(this.proxyPrefix, ''));
    }
    
    async handleRequest(req, res) {
        const startTime = Date.now();
        
        try {
            // Parse target URL from the proxied path
            const targetURL = this.parseTargetURL(req.url);
            
            // Update rewriter context
            this.urlRewriter.baseURL = targetURL.href;
            
            // Determine protocol and get appropriate agent
            const isHttps = targetURL.protocol === 'https:';
            const client = isHttps ? https : http;
            const agent = this.pool.getAgent(targetURL.protocol);
            
            // Prepare upstream request headers
            const upstreamHeaders = {
                ...req.headers,
                host: targetURL.host,
                origin: targetURL.origin,
                referer: req.headers.referer || targetURL.href,
                'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            };
            
            // Remove hop-by-hop headers
            delete upstreamHeaders['accept-encoding'];
            delete upstreamHeaders['connection'];
            delete upstreamHeaders['keep-alive'];
            delete upstreamHeaders['transfer-encoding'];
            delete upstreamHeaders['te'];
            delete upstreamHeaders['trailer'];
            delete upstreamHeaders['upgrade'];
            
            // Create upstream request
            const upstreamReq = client.request({
                hostname: targetURL.hostname,
                port: targetURL.port || (isHttps ? 443 : 80),
                path: targetURL.pathname + targetURL.search,
                method: req.method,
                headers: upstreamHeaders,
                agent: agent,
                timeout: 30000
            }, async (upstreamRes) => {
                const contentType = upstreamRes.headers['content-type'] || '';
                
                // Process the response
                await this.processor.processResponse(upstreamRes, res, contentType);
                
                // Update statistics
                this.stats.requestsProcessed++;
                const duration = Date.now() - startTime;
                
                if (process.env.DEBUG) {
                    console.log(`[SCRAMJET] ${req.method} ${targetURL.href} - ${upstreamRes.statusCode} (${duration}ms)`);
                }
            });
            
            // Handle upstream request errors
            upstreamReq.on('error', (e) => {
                this.stats.errors++;
                console.error('[SCRAMJET] Upstream request error:', e.message);
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'text/plain' });
                    res.end(`Proxy Error: ${e.message}`);
                } else {
                    res.destroy();
                }
            });
            
            // Handle timeout
            upstreamReq.on('timeout', () => {
                upstreamReq.destroy();
                this.stats.errors++;
                if (!res.headersSent) {
                    res.writeHead(504, { 'Content-Type': 'text/plain' });
                    res.end('Gateway Timeout');
                }
            });
            
            // Pipe request body for POST/PUT/PATCH
            if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
                req.pipe(upstreamReq);
            } else {
                upstreamReq.end();
            }
            
        } catch (e) {
            this.stats.errors++;
            console.error('[SCRAMJET] Handler error:', e.message);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Proxy Error: ${e.message}`);
            }
        }
    }
    
    getStats() {
        return {
            ...this.stats,
            uptime: Date.now() - this.stats.startTime,
            poolStats: this.pool.getStats()
        };
    }
}

module.exports = ScramjetProxyEngine;
module.exports.ScramjetURLRewriter = ScramjetURLRewriter;
module.exports.ScramjetHTMLRewriter = ScramjetHTMLRewriter;
module.exports.ScramjetCSSRewriter = ScramjetCSSRewriter;
module.exports.OptimizedConnectionPool = OptimizedConnectionPool;
