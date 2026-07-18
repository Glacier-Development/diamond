const http = require('http');
const https = require('https');
const { URL } = require('url');
const zlib = require('zlib');
const Iconv = require('iconv-lite');

class ConnectionPool {
    constructor() {
        this.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100, maxFreeSockets: 20, timeout: 60000, freeSocketTimeout: 30000 });
        this.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100, maxFreeSockets: 20, timeout: 60000, freeSocketTimeout: 30000, rejectUnauthorized: false });
    }
    getAgent(protocol) { return protocol === 'https:' ? this.httpsAgent : this.httpAgent; }
}

const pool = new ConnectionPool();

class URLRewriter {
    constructor(baseURL, proxyPrefix) {
        this.baseURL = baseURL;
        this.proxyPrefix = proxyPrefix;
        try { this.baseOrigin = new URL(baseURL).origin; } catch (e) { this.baseOrigin = ''; }
    }
    
    rewriteURL(url, context = 'auto') {
        if (!url || typeof url !== 'string') return url;
        url = url.trim();
        if (url.startsWith('javascript:') || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('#')) return url;
        if (url.startsWith('//')) url = this.baseURL.split(':')[0] + ':' + url;
        if (!url.match(/^https?:\/\//i)) {
            if (this.baseOrigin && !url.startsWith('/')) {
                const baseParts = this.baseURL.split('/');
                baseParts.pop();
                url = baseParts.join('/') + '/' + url;
            } else if (this.baseOrigin) {
                url = this.baseOrigin + (url.startsWith('/') ? '' : '/') + url;
            } else { return url; }
        }
        if (url.includes(this.proxyPrefix)) return url;
        try {
            const parsed = new URL(url);
            return `${this.proxyPrefix}${encodeURIComponent(parsed.href)}`;
        } catch (e) { return url; }
    }
}

class HTMLRewriter {
    constructor(rewriter) {
        this.rewriter = rewriter;
        this.urlAttributes = ['src', 'href', 'action', 'formaction', 'data', 'poster', 'background', 'cite', 'codebase', 'dynsrc', 'lowsrc', 'usemap', 'longdesc', 'profile', 'srcset', 'imagesrcset'];
    }
    
    rewrite(html, contentType = 'text/html') {
        if (!html || typeof html !== 'string') return html;
        let result = html;
        
        for (const attr of this.urlAttributes) {
            if (attr === 'srcset' || attr === 'imagesrcset') {
                result = this.rewriteSrcset(result, attr);
            } else {
                result = this.rewriteAttribute(result, attr);
            }
        }
        
        if (contentType.includes('text/html')) {
            result = this.injectClientScript(result);
        }
        
        return result;
    }
    
    rewriteAttribute(html, attrName) {
        const patterns = [
            new RegExp(`(${attrName})\\s*=\\s*"([^"]*)"`, 'gi'),
            new RegExp(`(${attrName})\\s*=\\s*'([^']*)'`, 'gi'),
            new RegExp(`(${attrName})\\s*=\\s*([^\\s>"']+)(?=[\\s>])`, 'gi')
        ];
        
        for (const pattern of patterns) {
            html = html.replace(pattern, (match, attr, value) => {
                if (!value) return match;
                const rewritten = this.rewriter.rewriteURL(value);
                return rewritten !== value ? `${attr}="${rewritten}"` : match;
            });
        }
        return html;
    }
    
    rewriteSrcset(html, attrName) {
        const pattern = new RegExp(`(${attrName})\\s*=\\s*"([^"]*)"`, 'gi');
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
        const script = `<script>(function(){if(window.__diamondProxyInitialized)return;window.__diamondProxyInitialized=true;const PROXY_PREFIX='${process.env.PROXY_PREFIX||'/proxy/'}';function rewriteURL(url){if(!url||typeof url!=='string')return url;if(url.startsWith('javascript:')||url.startsWith('data:')||url.startsWith('blob:')||url.startsWith('#'))return url;if(url.startsWith('//'))url=location.protocol+url;if(!url.match(/^https?:\\/\\//i)){try{url=new URL(url,location.href).href;}catch(e){return url;}}if(url.includes(PROXY_PREFIX))return url;return PROXY_PREFIX+encodeURIComponent(url);}if(window.fetch){const originalFetch=window.fetch;window.fetch=function(...args){if(args[0]instanceof Request){const req=args[0];const newUrl=rewriteURL(req.url);if(newUrl!==req.url){args[0]=new Request(newUrl,req);}}else if(typeof args[0]==='string'){args[0]=rewriteURL(args[0]);}return originalFetch.apply(this,args);};}if(window.XMLHttpRequest){const originalXHR=window.XMLHttpRequest;const patchedXHR=function(){const xhr=new originalXHR();const originalOpen=xhr.open;xhr.open=function(method,url,...rest){if(typeof url==='string'){url=rewriteURL(url);}return originalOpen.call(this,method,url,...rest);};return xhr;};Object.getOwnPropertyNames(originalXHR).forEach(prop=>{patchedXHR[prop]=originalXHR[prop];});window.XMLHttpRequest=patchedXHR;}if(window.WebSocket){const originalWS=window.WebSocket;window.WebSocket=function(url,protocols){if(typeof url==='string'){if(url.startsWith('ws://'))url='http://'+url.slice(5);if(url.startsWith('wss://'))url='https://'+url.slice(6);url=rewriteURL(url);if(url.startsWith('http://'))url='ws://'+url.slice(7);if(url.startsWith('https://'))url='wss://'+url.slice(8);}return new originalWS(url,protocols);};Object.getOwnPropertyNames(originalWS).forEach(prop=>{window.WebSocket[prop]=originalWS[prop];}}const descriptors={'src':['IMG','SCRIPT','VIDEO','AUDIO','SOURCE','IFRAME','EMBED','TRACK'],'href':['A','LINK','BASE','AREA'],'action':['FORM'],'data':['OBJECT'],'poster':['VIDEO'],'formAction':['BUTTON','INPUT']};for(const[prop,tags]of Object.entries(descriptors)){for(const tag of tags){const proto=window[tag]?.prototype;if(!proto)continue;const desc=Object.getOwnPropertyDescriptor(proto,prop)||Object.getOwnPropertyDescriptor(Element.prototype,prop);if(!desc||!desc.get)continue;const originalGetter=desc.get;const originalSetter=desc.set;Object.defineProperty(proto,prop,{get(){return originalGetter.call(this);},set(value){if(typeof value==='string'){value=rewriteURL(value);}return originalSetter?originalSetter.call(this,value):undefined;},configurable:true,enumerable:desc.enumerable});}}console.log('[Diamond Proxy] Client-side rewriting initialized');})();</script>`;
        
        if (html.includes('<head>')) return html.replace('<head>', '<head>' + script);
        if (html.includes('</head>')) return html.replace('</head>', script + '</head>');
        if (html.includes('<body>')) return html.replace('<body>', '<body>' + script);
        return script + html;
    }
}

class CSSRewriter {
    constructor(rewriter) { this.rewriter = rewriter; }
    rewrite(css) {
        if (!css || typeof css !== 'string') return css;
        return css.replace(/url\s*\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi, (match, quote, url) => {
            return `url('${this.rewriter.rewriteURL(url)}')`;
        });
    }
}

class ProxyEngine {
    constructor(options = {}) {
        this.proxyPrefix = options.proxyPrefix || '/proxy/';
        this.rewriter = new URLRewriter('', this.proxyPrefix);
        this.htmlRewriter = new HTMLRewriter(this.rewriter);
        this.cssRewriter = new CSSRewriter(this.rewriter);
    }
    
    parseTargetURL(requestedPath) {
        try {
            let encoded = requestedPath.replace(this.proxyPrefix, '');
            if (/^[A-Za-z0-9_-]+={0,2}$/.test(encoded)) {
                const padding = '='.repeat((4 - encoded.length % 4) % 4);
                const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + padding;
                encoded = Buffer.from(base64, 'base64').toString('utf8');
            } else {
                let prevDecoded;
                do {
                    prevDecoded = encoded;
                    try { encoded = decodeURIComponent(encoded.replace(/-/g, "%")); } catch (e) { break; }
                } while (encoded !== prevDecoded);
            }
            if (!encoded.match(/^https?:\/\//i)) encoded = 'https://' + encoded;
            const targetURL = new URL(encoded);
            if (this.isPrivateNetwork(targetURL.hostname)) throw new Error('Access to private network addresses is forbidden');
            return targetURL;
        } catch (e) {
            throw new Error(`Invalid target URL: ${e.message}`);
        }
    }
    
    handleRequest(req, res) {
        try {
            const targetURL = this.parseTargetURL(req.url);
            this.rewriter.baseURL = targetURL.href;
            const isHttps = targetURL.protocol === 'https:';
            const client = isHttps ? https : http;
            const agent = pool.getAgent(targetURL.protocol);
            
            const upstreamHeaders = { ...req.headers, host: targetURL.host, origin: targetURL.origin, referer: targetURL.href };
            delete upstreamHeaders['accept-encoding'];
            
            const upstreamReq = client.request({
                hostname: targetURL.hostname,
                port: targetURL.port || (isHttps ? 443 : 80),
                path: targetURL.pathname + targetURL.search,
                method: req.method,
                headers: upstreamHeaders,
                agent: agent,
                timeout: 30000
            }, (upstreamRes) => {
                const contentType = upstreamRes.headers['content-type'] || '';
                const shouldRewrite = contentType.includes('text/html') || contentType.includes('text/css');
                
                let responseHeaders = {
                    'Content-Type': contentType || 'application/octet-stream',
                    'Cache-Control': upstreamRes.headers['cache-control'] || 'no-cache',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range, X-Requested-With',
                    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Content-Encoding'
                };
                
                if (upstreamRes.headers['content-length']) responseHeaders['Content-Length'] = upstreamRes.headers['content-length'];
                
                if (upstreamRes.statusCode >= 300 && upstreamRes.statusCode < 400 && upstreamRes.headers.location) {
                    responseHeaders['Location'] = this.rewriter.rewriteURL(upstreamRes.headers.location);
                }
                
                if (shouldRewrite && (upstreamRes.statusCode === 200 || upstreamRes.statusCode === 304)) {
                    const chunks = [];
                    upstreamRes.on('data', chunk => chunks.push(chunk));
                    upstreamRes.on('end', () => {
                        let body = Buffer.concat(chunks);
                        if (upstreamRes.headers['content-encoding'] === 'gzip') { try { body = zlib.gunzipSync(body); } catch (e) {} }
                        else if (upstreamRes.headers['content-encoding'] === 'deflate') { try { body = zlib.inflateSync(body); } catch (e) {} }
                        
                        let charset = 'utf-8';
                        const charsetMatch = contentType.match(/charset=([^;]+)/i);
                        if (charsetMatch) charset = charsetMatch[1].trim();
                        
                        let text;
                        try { text = Iconv.decode(body, charset); } catch (e) { text = body.toString('utf-8'); }
                        
                        if (contentType.includes('text/html')) text = this.htmlRewriter.rewrite(text, contentType);
                        else if (contentType.includes('text/css')) text = this.cssRewriter.rewrite(text);
                        
                        const output = Iconv.encode(text, 'utf-8');
                        responseHeaders['Content-Length'] = output.length;
                        res.writeHead(upstreamRes.statusCode, responseHeaders);
                        res.end(output);
                    });
                } else {
                    res.writeHead(upstreamRes.statusCode, responseHeaders);
                    upstreamRes.pipe(res);
                }
                
                upstreamRes.on('error', (e) => {
                    console.error('[PROXY] Upstream error:', e.message);
                    if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end(`Proxy Error: ${e.message}`); }
                    else res.destroy();
                });
            });
            
            upstreamReq.on('error', (e) => {
                console.error('[PROXY] Request error:', e.message);
                if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end(`Proxy Error: ${e.message}`); }
                else res.destroy();
            });
            
            upstreamReq.on('timeout', () => {
                upstreamReq.destroy();
                if (!res.headersSent) { res.writeHead(504, { 'Content-Type': 'text/plain' }); res.end('Gateway Timeout'); }
            });
            
            if (['POST', 'PUT', 'PATCH'].includes(req.method)) req.pipe(upstreamReq);
            else upstreamReq.end();
            
        } catch (e) {
            console.error('[PROXY] Handler error:', e.message);
            if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(`Proxy Error: ${e.message}`); }
        }
    }
    
    isPrivateNetwork(hostname) {
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.local')) return true;
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

module.exports = ProxyEngine;
module.exports.URLRewriter = URLRewriter;
module.exports.HTMLRewriter = HTMLRewriter;
module.exports.CSSRewriter = CSSRewriter;
module.exports.ConnectionPool = ConnectionPool;
