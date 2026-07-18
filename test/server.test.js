import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'node:http';
import { createAdminRouter } from '../src/backend/admin.js';
import { createProxyRouter } from '../src/backend/proxy.js';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

let adminServer;
let adminUrl;
before(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'diamond-test-'));
  const settingsPath = path.join(dir, 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ motd: { enabled: false, message: '' }, maintenanceMode: false }));
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  createAdminRouter(app, { settingsPath, password: 'test-password' });
  adminServer = createServer(app);
  adminUrl = await listen(adminServer);
});
after(() => adminServer.close());

test('admin API authenticates, persists MOTD, and protects settings', async () => {
  assert.equal((await fetch(`${adminUrl}/api/admin/settings`)).status, 401);
  const login = await fetch(`${adminUrl}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const save = await fetch(`${adminUrl}/api/admin/motd`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, message: 'Ready' }) });
  assert.equal(save.status, 200);
  const settings = await fetch(`${adminUrl}/api/admin/settings`, { headers: { cookie } });
  assert.deepEqual(await settings.json(), { motd: 'Ready', motdEnabled: true, maintenanceMode: false });
});

test('proxy streams an upstream response and removes iframe-blocking headers', async () => {
  const upstream = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/plain', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" }).end('proxied'));
  const upstreamUrl = await listen(upstream);
  const app = express();
  const proxy = createProxyRouter(app);
  const server = createServer(app);
  const url = await listen(server);
  const encoded = Buffer.from(upstreamUrl).toString('base64url');
  const response = await fetch(`${url}/proxy/~/${encoded}`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'proxied');
  assert.equal(response.headers.get('x-frame-options'), null);
  assert.equal(response.headers.get('content-security-policy'), null);
  await new Promise((resolve) => server.close(resolve));
  proxy.close();
  await new Promise((resolve) => upstream.close(resolve));
});
