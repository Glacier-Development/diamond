const express = require('express');
const path = require('path');
const { proxyHandler, rewriteUrl } = require('./src/proxy');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Serve static files from public directory with caching
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d', // Cache static assets for 1 day
  etag: true,
  lastModified: true
}));

// Serve JSON data files
app.use('/data', express.static(path.join(__dirname, 'data'), {
  maxAge: '5m', // Cache JSON files for 5 minutes
  setHeaders: (res, filepath) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300');
  }
}));

// Proxy endpoint - handles all proxied requests
app.all('/proxy/*', proxyHandler);

// Health check endpoint for deployment platforms
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
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
  console.log(`Diamond Proxy running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
