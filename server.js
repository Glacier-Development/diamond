import express from 'express';
import { createServer } from 'http';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { createAdminRouter } from './src/backend/admin.js';
import { createProxyRouter } from './src/backend/proxy.js';
import { attachScramjet } from './src/backend/scramjet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.join(__dirname, 'public');
const settingsPath = path.join(__dirname, 'config', 'settings.json');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(cookieParser());

  createAdminRouter(app, { settingsPath });
  const proxy = createProxyRouter(app);

  app.get('/health', (req, res) => res.json({ status: 'ok', version: '5.2.0', engine: 'Diamond Scramjet runtime with streaming fallback' }));
  app.use('/data', express.static(path.join(__dirname, 'data'), { maxAge: '5m', immutable: false }));
  return { app, proxy };
}

function attachStaticAndNotFound(app) {
  app.use(express.static(publicPath, { maxAge: '1h', etag: true, lastModified: true }));
  app.use((req, res) => res.status(404).sendFile(path.join(publicPath, '404.html')));
}

export function startServer(port = process.env.PORT || 3000) {
  const { app, proxy } = createApp();
  const server = createServer(app);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  attachScramjet(app, server).then((state) => {
    attachStaticAndNotFound(app);
    server.listen(port, '0.0.0.0', () => console.log(`Diamond listening on port ${port} (scramjet=${state.scramjet}, wisp=${state.wisp})`));
  });
  server.on('close', proxy.close);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
