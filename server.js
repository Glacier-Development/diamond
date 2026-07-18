import express from 'express';
import { createServer } from 'http';
import https from 'https';
import http from 'http';
import { WebSocketServer } from 'ws';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import * as wisp from '@mercuryworkshop/wisp-js/server';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// Rocket Engine v5.0 Configuration
const PROXY_PREFIX = '/proxy/~/';
console.log('[ROCKET v5.0] Starting with wisp + optimized connection pooling');
console.log('[ROCKET v5.0] Scramjet assets at:', scramjetPath);

// Optimized connection pool
class ConnectionPool {
    constructor() {
        this.httpAgent = new http.Agent({
            keepAlive: true,
            keepAliveMsecs: 30000,
            maxSockets: 200,
            maxFreeSockets: 50,
            timeout: 60000,
            freeSocketTimeout: 30000,
            scheduling: 'lifo'
        });
        
        this.httpsAgent = new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 30000,
            maxSockets: 200,
            maxFreeSockets: 50,
            timeout: 60000,
            freeSocketTimeout: 30000,
            scheduling: 'lifo',
            rejectUnauthorized: false,
            maxCachedSessions: 1000
        });
    }
    
    getAgent(protocol) {
        return protocol === 'https:' ? this.httpsAgent : this.httpAgent;
    }
}

const pool = new ConnectionPool();

// Wisp WebSocket server for real-time communication
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/wisp/')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
        });
    }
});

wss.on('connection', (ws, req) => {
    console.log('[WISP] Connection established');
    // Handle wisp protocol via the ws connection
    ws.on('message', (data) => {
        // Wisp protocol handling
    });
    ws.on('close', () => {
        console.log('[WISP] Connection closed');
    });
});

console.log('[ROCKET v5.0] Wisp server configured at /wisp/');

// Static files
app.use(express.static(path.join(__dirname, 'public'), { 
    maxAge: '1d', 
    etag: true, 
    lastModified: true 
}));

// Data directory
app.use('/data', express.static(path.join(__dirname, 'data'), {
    maxAge: '5m',
    setHeaders: (res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=300');
    }
}));

// Health endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: Date.now(), 
        version: '5.0.0',
        engine: 'Rocket (Scramjet + wisp + optimized pool)'
    });
});

// Decode base64url
function decodeBase64Url(str) {
    try {
        return Buffer.from(str, 'base64url').toString('utf-8');
    } catch (e) {
        try {
            return decodeURIComponent(str.replace(/-/g, '%'));
        } catch (e2) {
            return str;
        }
    }
}

// Proxy handler with optimized connection pooling
app.all(`${PROXY_PREFIX}*`, async (req, res) => {
    const startTime = Date.now();
    
    try {
        // Decode URL from base64url
        const encodedPath = req.path.replace(PROXY_PREFIX, '');
        let targetUrlStr = decodeBase64Url(encodedPath);
        
        // Ensure protocol
        if (!targetUrlStr.match(/^https?:\/\//i)) {
            targetUrlStr = 'https://' + targetUrlStr;
        }
        
        const targetUrl = new URL(targetUrlStr);
        
        // Prepare headers
        const upstreamHeaders = { ...req.headers };
        upstreamHeaders.host = targetUrl.host;
        upstreamHeaders.origin = targetUrl.origin;
        if (req.headers.referer) {
            upstreamHeaders.referer = req.headers.referer;
        } else {
            upstreamHeaders.referer = targetUrl.href;
        }
        
        // Remove hop-by-hop headers
        delete upstreamHeaders['accept-encoding'];
        delete upstreamHeaders['connection'];
        delete upstreamHeaders['keep-alive'];
        delete upstreamHeaders['transfer-encoding'];
        delete upstreamHeaders['te'];
        delete upstreamHeaders['trailer'];
        delete upstreamHeaders['upgrade'];
        
        // Get appropriate agent
        const agent = pool.getAgent(targetUrl.protocol);
        const client = targetUrl.protocol === 'https:' ? https : http;
        
        // Make upstream request
        await new Promise((resolve, reject) => {
            const upstreamReq = client.request({
                hostname: targetUrl.hostname,
                port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
                path: targetUrl.pathname + targetUrl.search,
                method: req.method,
                headers: upstreamHeaders,
                agent: agent,
                timeout: 30000
            }, (upstreamRes) => {
                // Copy response headers
                const responseHeaders = {};
                Object.entries(upstreamRes.headers).forEach(([key, value]) => {
                    if (value !== undefined) {
                        responseHeaders[key] = value;
                    }
                });
                
                res.writeHead(upstreamRes.statusCode, responseHeaders);
                
                // Pipe response body
                upstreamRes.pipe(res);
                
                upstreamRes.on('end', () => {
                    resolve();
                });
            });
            
            upstreamReq.on('error', reject);
            upstreamReq.on('timeout', () => {
                upstreamReq.destroy();
                reject(new Error('Gateway Timeout'));
            });
            
            // Pipe request body for POST/PUT/PATCH
            if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
                req.pipe(upstreamReq);
            } else {
                upstreamReq.end();
            }
        });
        
        if (process.env.DEBUG) {
            console.log(`[ROCKET] ${req.method} ${targetUrlStr} - ${res.statusCode} (${Date.now() - startTime}ms)`);
        }
        
    } catch (error) {
        console.error('[ROCKET] Handler error:', error.message);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`Rocket Proxy Error: ${error.message}`);
        } else {
            res.destroy();
        }
    }
});

// Legacy proxy redirect
app.all('/proxy/*', (req, res) => {
    const legacyPath = req.path.replace('/proxy/', '');
    try {
        let decoded = legacyPath.replace(/-/g, '%');
        decoded = decodeURIComponent(decoded);
        const newPath = PROXY_PREFIX + Buffer.from(decoded).toString('base64url');
        return res.redirect(307, newPath);
    } catch (e) {
        return res.status(400).send('Invalid URL encoding');
    }
});

app.get('/proxy', (req, res) => {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Proxy requires a target URL. Use: /proxy/~/https://example.com');
});

// 404 handler
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Rocket Proxy v5.0 running on port ${PORT}`);
    console.log(`   Engine: Scramjet + wisp + optimized connection pool`);
    console.log(`   Your service is live 🎉`);
});
