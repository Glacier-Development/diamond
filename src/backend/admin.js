import crypto from 'crypto';
import fs from 'fs/promises';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function createAdminRouter(app, { settingsPath, password = process.env.ADMIN_PASSWORD || 'DiamondAdmin2024!Secure' }) {
  const sessions = new Map();
  let settings;
  let writeQueue = Promise.resolve();

  const loadSettings = async () => {
    if (!settings) settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    return settings;
  };
  const persist = async () => {
    writeQueue = writeQueue.then(() => fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`));
    return writeQueue;
  };
  const authenticated = (req) => {
    const token = req.cookies?.diamond_admin;
    const expires = token && sessions.get(token);
    if (!expires || expires < Date.now()) {
      if (token) sessions.delete(token);
      return false;
    }
    return true;
  };
  const requireAdmin = (req, res, next) => authenticated(req) ? next() : res.status(401).json({ error: 'Authentication required' });

  app.post('/api/admin/login', async (req, res) => {
    const supplied = Buffer.from(String(req.body?.password || ''));
    const expected = Buffer.from(password);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    res.cookie('diamond_admin', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_TTL_MS });
    return res.json({ success: true });
  });

  app.get('/api/admin/session', (req, res) => res.json({ authenticated: authenticated(req) }));
  app.get('/api/admin/settings', requireAdmin, async (req, res) => {
    const current = await loadSettings();
    res.json({ motd: current.motd?.message || '', motdEnabled: Boolean(current.motd?.enabled), maintenanceMode: Boolean(current.maintenanceMode) });
  });
  app.post('/api/admin/motd', requireAdmin, async (req, res) => {
    const current = await loadSettings();
    current.motd = { enabled: Boolean(req.body?.enabled), message: String(req.body?.message || '').slice(0, 500) };
    await persist();
    res.json({ success: true });
  });
  app.post('/api/admin/maintenance', requireAdmin, async (req, res) => {
    const current = await loadSettings();
    current.maintenanceMode = Boolean(req.body?.enabled);
    await persist();
    res.json({ success: true });
  });
  app.post('/api/admin/restart', requireAdmin, (req, res) => res.status(501).json({ error: 'Restart is managed by the hosting process' }));
}
