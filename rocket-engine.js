/**
 * Rocket Engine v5.0 - High-Performance Proxy using Scramjet + libcurl + wisp
 * 
 * Built on MercuryWorkshop's Scramjet technology with:
 * - libcurl transport for faster HTTP/HTTPS requests
 * - Wisp protocol for WebSocket support
 * - Optimized for low-end devices
 */

import { createServer } from 'http';
import { URL } from 'url';
import { scramjetPath } from '@mercuryworkshop/scramjet/path';
import { wisp } from '@mercuryworkshop/wisp-js/server';
import { curl } from '@mercuryworkshop/libcurl-transport';
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class RocketEngine {
    constructor(options = {}) {
        this.proxyPrefix = options.proxyPrefix || '/proxy/~/';
        this.wispServer = null;
        this.stats = {
            requestsProcessed: 0,
            bytesTransferred: 0,
            errors: 0,
            startTime: Date.now()
        };
        
        console.log('[ROCKET ENGINE] Initializing with libcurl transport + wisp');
        console.log('[ROCKET ENGINE] Scramjet path:', scramjetPath);
    }
    
    setupWispServer(server) {
        const wss = new WebSocketServer({ 
            noServer: true,
            path: '/wisp/'
        });
        
        wss.on('connection', (ws, req) => {
            wisp.routeWebSocket(req, ws, {
                onConnect: () => console.log('[WISP] Connection established'),
                onClose: () => console.log('[WISP] Connection closed')
            });
        });
        
        server.on('upgrade', (req, socket, head) => {
            if (req.url.startsWith('/wisp/')) {
                wss.handleUpgrade(req, socket, head, (ws) => {
                    wss.emit('connection', ws, req);
                });
            }
        });
        
        this.wispServer = wss;
        console.log('[ROCKET ENGINE] Wisp server configured at /wisp/');
    }
    
    encodeUrl(url) {
        if (!url) return url;
        return Buffer.from(url, 'utf-8').toString('base64url');
    }
    
    decodeUrl(str) {
        if (!str) return str;
        try {
            return Buffer.from(str, 'base64url').toString('utf-8');
        } catch (e) {
            try {
                let decoded = str.replace(/-/g, '%');
                return decodeURIComponent(decoded);
            } catch (e2) {
                return str;
            }
        }
    }
    
    parseTargetURL(requestedPath) {
        const encoded = requestedPath.replace(this.proxyPrefix, '');
        const decoded = this.decodeUrl(encoded);
        let targetUrl = decoded;
        if (!targetUrl.match(/^https?:\/\//i)) {
            targetUrl = 'https://' + targetUrl;
        }
        return new URL(targetUrl);
    }
    
    async handleRequest(req, res) {
        const startTime = Date.now();
        
        try {
            const targetURL = this.parseTargetURL(req.url);
            
            // Use libcurl transport for better performance
            const response = await curl.fetch(targetURL.href, {
                method: req.method,
                headers: req.headers,
                body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? req : undefined
            });
            
            // Copy response headers
            const headers = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });
            
            res.writeHead(response.status, headers);
            
            // Stream response body
            if (response.body) {
                for await (const chunk of response.body) {
                    res.write(chunk);
                    this.stats.bytesTransferred += chunk.length;
                }
            }
            
            res.end();
            this.stats.requestsProcessed++;
            
            if (process.env.DEBUG) {
                console.log(`[ROCKET] ${req.method} ${targetURL.href} - ${response.status} (${Date.now() - startTime}ms)`);
            }
            
        } catch (error) {
            this.stats.errors++;
            console.error('[ROCKET] Handler error:', error.message);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Rocket Proxy Error: ${error.message}`);
            } else {
                res.destroy();
            }
        }
    }
    
    getStats() {
        return {
            ...this.stats,
            uptime: Date.now() - this.stats.startTime
        };
    }
}

export default RocketEngine;
