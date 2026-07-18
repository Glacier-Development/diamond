const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const ScramjetEngine = require('./scramjet-engine');
const settings = require('./config/settings.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Scramjet-powered proxy engine with optimized settings
const proxyEngine = new ScramjetEngine({
    proxyPrefix: '/proxy/~/',
    poolConfig: {
        maxSockets: 250,
        maxFreeSockets: 60,
        timeout: 45000,
        freeSocketTimeout: 25000
    }
});

process.env.PROXY_PREFIX = '/proxy/~/';

const ADMIN_PASSWORD_HASH = crypto.createHash('sha256').update('DiamondAdmin2024!Secure').digest('hex');

let maintenanceMode = false;
let maintenanceMessage = 'Diamond Proxy is under maintenance.';
let motdMessage = settings.motd.message;
let motdEnabled = settings.motd.enabled;

app.use(cookieParser());
app.use(express.json({ limit: settings.features.maxUploadSize }));
app.use(express.urlencoded({ extended: true, limit: settings.features.maxUploadSize }));

const globalLimiter = rateLimit({
  windowMs: 60000,
  max: 500,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/css/') || req.path.startsWith('/js/') || req.path.startsWith('/proxy/~/')
});
app.use(globalLimiter);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range, X-Requested-With');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
  next();
});

app.use((req, res, next) => {
  if (maintenanceMode && !req.path.startsWith('/api/') && req.path !== '/') {
    return res.status(503).json({ error: 'Maintenance Mode', message: maintenanceMessage });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d', etag: true, lastModified: true }));

app.use('/data', express.static(path.join(__dirname, 'data'), {
  maxAge: '5m',
  setHeaders: (res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300');
  }
}));

app.all('/proxy/~/*', (req, res) => { proxyEngine.handleRequest(req, res); });

app.all('/proxy/*', (req, res) => {
    const legacyPath = req.path.replace('/proxy/', '');
    try {
        let decoded = legacyPath.replace(/-/g, '%');
        decoded = decodeURIComponent(decoded);
        const newPath = '/proxy/~/' + Buffer.from(decoded).toString('base64url');
        return res.redirect(307, newPath);
    } catch (e) {
        return res.status(400).send('Invalid URL encoding');
    }
});

app.all('/proxy', (req, res) => {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Proxy requires a target URL. Use: /proxy/~/https://example.com');
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now(), version: '4.0.0', maintenance: maintenanceMode });
});

app.get('/api/motd', (req, res) => {
  res.json({ success: true, motd: motdEnabled ? { message: motdMessage, enabled: true } : null });
});

const adminAuthMiddleware = (req, res, next) => {
  const adminToken = req.cookies.admin_token;
  if (!adminToken) return res.status(401).json({ error: 'Admin authentication required' });
  
  try {
    const [timestamp, hash] = adminToken.split(':');
    const expectedHash = crypto.createHash('sha256').update(timestamp + ADMIN_PASSWORD_HASH).digest('hex');
    if (hash !== expectedHash) return res.status(401).json({ error: 'Invalid admin token' });
    if (Date.now() - parseInt(timestamp) > 8 * 60 * 60 * 1000) return res.status(401).json({ error: 'Admin session expired' });
    req.isAdmin = true;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid admin token format' });
  }
};

app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });
    
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    if (passwordHash !== ADMIN_PASSWORD_HASH) {
      console.warn(`[ADMIN] Failed login attempt from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    const timestamp = Date.now().toString();
    const tokenHash = crypto.createHash('sha256').update(timestamp + ADMIN_PASSWORD_HASH).digest('hex');
    const adminToken = `${timestamp}:${tokenHash}`;
    
    res.cookie('admin_token', adminToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000
    });
    
    console.log(`[ADMIN] Successful login from ${req.ip}`);
    res.json({ success: true, message: 'Admin access granted' });
  } catch (error) {
    console.error('[ADMIN] Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

app.get('/api/admin/verify', adminAuthMiddleware, (req, res) => {
  res.json({ success: true, isAdmin: true });
});

app.post('/api/admin/motd', adminAuthMiddleware, async (req, res) => {
  try {
    const { message, enabled } = req.body;
    if (message !== undefined) motdMessage = message;
    if (enabled !== undefined) motdEnabled = enabled;
    console.log(`[ADMIN] MOTD updated by ${req.ip}: "${motdMessage}" (enabled: ${motdEnabled})`);
    res.json({ success: true, motd: { message: motdMessage, enabled: motdEnabled } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update MOTD' });
  }
});

app.post('/api/admin/maintenance', adminAuthMiddleware, async (req, res) => {
  try {
    const { enabled, message } = req.body;
    if (enabled !== undefined) maintenanceMode = enabled;
    if (message !== undefined) maintenanceMessage = message;
    console.log(`[ADMIN] Maintenance mode ${maintenanceMode ? 'enabled' : 'disabled'} by ${req.ip}`);
    res.json({ success: true, maintenance: { enabled: maintenanceMode, message: maintenanceMessage } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update maintenance mode' });
  }
});

app.post('/api/admin/restart', adminAuthMiddleware, async (req, res) => {
  try {
    console.log(`[ADMIN] Server restart requested by ${req.ip}`);
    res.json({ success: true, message: 'Server restarting...' });
    setTimeout(() => process.exit(0), 1000);
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart server' });
  }
});

app.post('/api/rewrite', express.json(), (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Invalid URL provided' });
    let proxiedUrl = url;
    if (url.match(/^https?:\/\//i)) proxiedUrl = '/proxy/~/' + encodeURIComponent(url);
    res.json({ success: true, proxiedUrl });
  } catch (error) {
    res.status(500).json({ error: 'Failed to rewrite URL' });
  }
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.get('/api/admin/settings', adminAuthMiddleware, (req, res) => {
  res.json({ motd: motdMessage, motdEnabled, maintenanceMode });
});

app.get('/api/admin/session', (req, res) => {
  const adminToken = req.cookies.admin_token;
  if (!adminToken) return res.json({ authenticated: false });
  
  try {
    const [timestamp, hash] = adminToken.split(':');
    const expectedHash = crypto.createHash('sha256').update(timestamp + ADMIN_PASSWORD_HASH).digest('hex');
    if (hash !== expectedHash) return res.json({ authenticated: false });
    if (Date.now() - parseInt(timestamp) > 8 * 60 * 60 * 1000) return res.json({ authenticated: false });
    res.json({ authenticated: true });
  } catch (e) {
    res.json({ authenticated: false });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Diamond Proxy v4.0.0 running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Maintenance mode: ${maintenanceMode}`);
  console.log('==> Your service is live 🎉');
});
