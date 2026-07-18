import http from 'http';
import https from 'https';
import { pipeline } from 'stream/promises';

const HOP_BY_HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const RESPONSE_HEADERS_TO_REMOVE = new Set(['content-security-policy', 'content-security-policy-report-only', 'x-frame-options']);

export function decodeProxyTarget(encoded) {
  const value = Buffer.from(encoded, 'base64url').toString('utf8');
  const target = new URL(value);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Only HTTP(S) URLs are supported');
  return target;
}

export function createProxyRouter(app, { prefix = '/proxy/~/' } = {}) {
  const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 256, maxFreeSockets: 64, scheduling: 'lifo' });
  const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 256, maxFreeSockets: 64, scheduling: 'lifo', maxCachedSessions: 256 });

  app.all(`${prefix}*`, async (req, res, next) => {
    let target;
    try { target = decodeProxyTarget(req.params[0]); } catch (error) { return res.status(400).json({ error: `Invalid proxy URL: ${error.message}` }); }
    const client = target.protocol === 'https:' ? https : http;
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== 'host'));
    headers.host = target.host;

    const upstream = client.request(target, { method: req.method, headers, agent: target.protocol === 'https:' ? httpsAgent : httpAgent, timeout: 30_000 }, async (upstreamRes) => {
      const responseHeaders = Object.fromEntries(Object.entries(upstreamRes.headers).filter(([name, value]) => value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && !RESPONSE_HEADERS_TO_REMOVE.has(name.toLowerCase())));
      if (responseHeaders.location) responseHeaders.location = new URL(responseHeaders.location, target).href;
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      try { await pipeline(upstreamRes, res); } catch { if (!res.destroyed) res.destroy(); }
    });
    upstream.on('timeout', () => upstream.destroy(new Error('Upstream request timed out')));
    upstream.on('error', (error) => { if (!res.headersSent) res.status(502).json({ error: 'Upstream request failed', detail: error.message }); });
    if (['GET', 'HEAD'].includes(req.method)) upstream.end(); else req.pipe(upstream);
  });
  return { close: () => { httpAgent.destroy(); httpsAgent.destroy(); } };
}
