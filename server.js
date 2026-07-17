const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const ProxyEngine = require('./src/proxy-engine');
const settings = require('./config/settings.json');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize proxy engine
const proxyEngine = new ProxyEngine({
    proxyPrefix: '/proxy/~/'
});

// Set environment variable for client-side script
process.env.PROXY_PREFIX = '/proxy/~/';

// Admin password hash (change this!)
const ADMIN_PASSWORD_HASH = crypto.createHash('sha256').update('DiamondAdmin2024!Secure').digest('hex');

// In-memory state
let maintenanceMode = false;
let maintenanceMessage = 'Diamond Proxy is under maintenance.';
let motdMessage = settings.motd.message;
let motdEnabled = settings.motd.enabled;

// Parse cookies
app.use(cookieParser());

// Parse JSON bodies
app.use(express.json({ limit: settings.features.maxUploadSize }));
app.use(express.urlencoded({ extended: true, limit: settings.features.maxUploadSize }));

// Global rate limiter - very lenient for testing
const globalLimiter = rateLimit({
  windowMs: 60000, // 1 minute
  max: 500, // 500 requests per minute - much more lenient
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for static assets and proxy requests
    return req.path.startsWith('/css/') || 
           req.path.startsWith('/js/') || 
           req.path.startsWith('/proxy/~/');
  }
});
app.use(globalLimiter);

// Security headers middleware
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

// Maintenance mode middleware (skip for API and static files)
app.use((req, res, next) => {
  if (maintenanceMode && !req.path.startsWith('/api/') && req.path !== '/') {
    return res.status(503).json({
      error: 'Maintenance Mode',
      message: maintenanceMessage
    });
  }
  next();
});

// Serve static files from public directory with caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// Serve JSON data files
app.use('/data', express.static(path.join(__dirname, 'data'), {
  maxAge: '5m',
  setHeaders: (res, filepath) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300');
  }
}));

// Proxy endpoint - handles all proxied requests with new engine
app.all('/proxy/~/*', (req, res) => {
    proxyEngine.handleRequest(req, res);
});

// Also handle root proxy requests without trailing slash
app.all('/proxy', (req, res) => {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Proxy requires a target URL. Use: /proxy/~/https://example.com');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: Date.now(),
    version: '3.0.0',
    maintenance: maintenanceMode
  });
});

// Get MOTD
app.get('/api/motd', (req, res) => {
  res.json({ 
    success: true,
    motd: motdEnabled ? { message: motdMessage, enabled: true } : null
  });
});

// Admin authentication middleware (session-based via cookie)
const adminAuthMiddleware = (req, res, next) => {
  const adminToken = req.cookies.admin_token;
  
  if (!adminToken) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  // Verify token (simple hash verification)
  try {
    const [timestamp, hash] = adminToken.split(':');
    const expectedHash = crypto.createHash('sha256').update(timestamp + ADMIN_PASSWORD_HASH).digest('hex');
    
    if (hash !== expectedHash) {
      return res.status(401).json({ error: 'Invalid admin token' });
    }
    
    // Check if token is older than 8 hours
    if (Date.now() - parseInt(timestamp) > 8 * 60 * 60 * 1000) {
      return res.status(401).json({ error: 'Admin session expired' });
    }
    
    req.isAdmin = true;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid admin token format' });
  }
};

// Admin login endpoint
app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }
    
    // Hash the provided password
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    
    if (passwordHash !== ADMIN_PASSWORD_HASH) {
      // Log failed attempt (with rate limiting consideration)
      console.warn(`[ADMIN] Failed login attempt from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    // Create session token
    const timestamp = Date.now().toString();
    const tokenHash = crypto.createHash('sha256').update(timestamp + ADMIN_PASSWORD_HASH).digest('hex');
    const adminToken = `${timestamp}:${tokenHash}`;
    
    // Set secure cookie
    res.cookie('admin_token', adminToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000 // 8 hours
    });
    
    console.log(`[ADMIN] Successful login from ${req.ip}`);
    res.json({ success: true, message: 'Admin access granted' });
  } catch (error) {
    console.error('[ADMIN] Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Admin logout
app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

// Verify admin session
app.get('/api/admin/verify', adminAuthMiddleware, (req, res) => {
  res.json({ success: true, isAdmin: true });
});

// Admin routes
app.post('/api/admin/motd', adminAuthMiddleware, async (req, res) => {
  try {
    const { message, enabled } = req.body;
    
    if (message !== undefined) {
      motdMessage = message;
    }
    if (enabled !== undefined) {
      motdEnabled = enabled;
    }
    
    console.log(`[ADMIN] MOTD updated by ${req.ip}: "${motdMessage}" (enabled: ${motdEnabled})`);
    res.json({ success: true, motd: { message: motdMessage, enabled: motdEnabled } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update MOTD' });
  }
});

app.post('/api/admin/maintenance', adminAuthMiddleware, async (req, res) => {
  try {
    const { enabled, message } = req.body;
    
    if (enabled !== undefined) {
      maintenanceMode = enabled;
    }
    if (message !== undefined) {
      maintenanceMessage = message;
    }
    
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
    
    // Graceful restart
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart server' });
  }
});

// API endpoint to validate and rewrite URLs
app.post('/api/rewrite', express.json(), (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Simple URL rewriting for API
    let proxiedUrl = url;
    if (url.match(/^https?:\/\//i)) {
      proxiedUrl = '/proxy/~/' + encodeURIComponent(url);
    }
    res.json({ success: true, proxiedUrl: proxiedUrl });
  } catch (error) {
    res.status(500).json({ error: 'Failed to rewrite URL' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Diamond Proxy v3.0.0 running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Maintenance mode: ${maintenanceMode}`);
  console.log('==> Your service is live 🎉');
  console.log('==>');
  console.log('///////////////////////////////////////////////////////////////');
  console.log('==>');
  console.log(`==> Available at your primary URL https://diamond-lav6.onrender.com`);
  console.log('==>');
  console.log('///////////////////////////////////////////////////////////////');
});


// Admin settings endpoint (combined)
app.get('/api/admin/settings', adminAuthMiddleware, (req, res) => {
  res.json({
    motd: motdMessage,
    motdEnabled: motdEnabled,
    maintenanceMode: maintenanceMode
  });
});

// Session check endpoint
app.get('/api/admin/session', (req, res) => {
  const adminToken = req.cookies.admin_token;
  
  if (!adminToken) {
    return res.json({ authenticated: false });
  }
  
  try {
    const [timestamp, hash] = adminToken.split(':');
    const expectedHash = crypto.createHash('sha256').update(timestamp + ADMIN_PASSWORD_HASH).digest('hex');
    
    if (hash !== expectedHash) {
      return res.json({ authenticated: false });
    }
    
    if (Date.now() - parseInt(timestamp) > 8 * 60 * 60 * 1000) {
      return res.json({ authenticated: false });
    }
    
    res.json({ authenticated: true });
  } catch (e) {
    res.json({ authenticated: false });
  }
});
