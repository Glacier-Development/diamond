const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { proxyHandler, rewriteUrl } = require('./src/proxy');
const settings = require('./config/settings.json');
const db = require('./src/database');
const auth = require('./src/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
db.initializeDatabase();

// Parse cookies
app.use(cookieParser());

// Parse JSON bodies
app.use(express.json({ limit: settings.features.maxUploadSize }));
app.use(express.urlencoded({ extended: true, limit: settings.features.maxUploadSize }));

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: settings.rateLimit.windowMs,
  max: settings.rateLimit.maxRequests,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
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

// Maintenance mode middleware
app.use((req, res, next) => {
  if (settings.maintenance.enabled && !req.path.startsWith('/api/auth')) {
    return res.status(503).json({
      error: 'Maintenance Mode',
      message: settings.maintenance.message
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

// Proxy endpoint - handles all proxied requests
app.all('/proxy/*', proxyHandler);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: Date.now(),
    version: '2.0.0',
    maintenance: settings.maintenance.enabled
  });
});

// Get MOTD
app.get('/api/motd', async (req, res) => {
  try {
    const motd = await db.getMotd();
    const configMotd = settings.motd.enabled ? { message: settings.motd.message, enabled: true } : null;
    res.json({ 
      success: true,
      motd: motd || configMotd
    });
  } catch (error) {
    res.json({ success: false, motd: settings.motd.enabled ? { message: settings.motd.message } : null });
  }
});

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    
    if (!settings.auth.enabled) {
      return res.status(400).json({ error: 'Authentication is disabled' });
    }
    
    const result = await auth.registerUser(username, email, password, ipAddress);
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    // Set token in cookie
    res.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: settings.auth.sessionTimeout
    });
    
    res.status(201).json(result);
  } catch (error) {
    console.error('[AUTH] Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    
    if (!settings.auth.enabled) {
      return res.status(400).json({ error: 'Authentication is disabled' });
    }
    
    const result = await auth.loginUser(username, password, ipAddress, userAgent);
    
    if (!result.success) {
      return res.status(401).json(result);
    }
    
    // Set token in cookie
    res.cookie('token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: settings.auth.sessionTimeout
    });
    
    res.json(result);
  } catch (error) {
    console.error('[AUTH] Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', auth.authMiddleware, async (req, res) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
    await auth.logoutUser(token);
    
    res.clearCookie('token');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Logout failed' });
  }
});

app.get('/api/auth/me', auth.authMiddleware, async (req, res) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.replace('Bearer ', '');
    const user = await auth.getCurrentUser(token);
    
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Admin routes
app.post('/api/admin/motd', auth.authMiddleware, auth.adminMiddleware, async (req, res) => {
  try {
    const { message, enabled = true } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }
    
    const result = await db.setMotd(message, req.user.userId, enabled);
    
    if (!result.success) {
      return res.status(500).json(result);
    }
    
    await db.logServerEvent('MOTD_UPDATE', `MOTD updated by ${req.user.username}`, req.user.userId);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update MOTD' });
  }
});

app.post('/api/admin/maintenance', auth.authMiddleware, auth.adminMiddleware, async (req, res) => {
  try {
    const { enabled, message } = req.body;
    
    // Update settings in memory (in production, this should persist to file/db)
    settings.maintenance.enabled = enabled;
    if (message) {
      settings.maintenance.message = message;
    }
    
    await db.logServerEvent(
      enabled ? 'MAINTENANCE_ENABLE' : 'MAINTENANCE_DISABLE',
      `Maintenance mode ${enabled ? 'enabled' : 'disabled'} by ${req.user.username}`,
      req.user.userId
    );
    
    res.json({ success: true, maintenance: settings.maintenance });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update maintenance mode' });
  }
});

app.post('/api/admin/restart', auth.authMiddleware, auth.adminMiddleware, async (req, res) => {
  try {
    await db.logServerEvent(
      'SERVER_RESTART',
      `Server restart requested by ${req.user.username}`,
      req.user.userId
    );
    
    res.json({ success: true, message: 'Server restarting...' });
    
    // Graceful restart
    setTimeout(() => {
      process.exit(0);
    }, 1000);
  } catch (error) {
    res.status(500).json({ error: 'Failed to restart server' });
  }
});

app.get('/api/admin/events', auth.authMiddleware, auth.adminMiddleware, async (req, res) => {
  try {
    const { data, error } = await db.supabase
      .from('server_events')
      .select('*, users(username)')
      .order('created_at', { ascending: false })
      .limit(50);
    
    if (error) throw error;
    
    res.json({ success: true, events: data || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// API endpoint to validate and rewrite URLs
app.post('/api/rewrite', express.json(), (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    const rewritten = rewriteUrl(url);
    res.json({ success: true, proxiedUrl: rewritten });
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
  console.log(`Diamond Proxy v2.0.0 running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Auth enabled: ${settings.auth.enabled}`);
  console.log(`Maintenance mode: ${settings.maintenance.enabled}`);
});
