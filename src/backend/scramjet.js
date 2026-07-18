import express from 'express';

export async function attachScramjet(app, server = null) {
  const state = { scramjet: false, wisp: false, libcurl: false, wasm: false, reason: null };

  try {
    const [{ scramjetPath }, wispModule, libcurlModule] = await Promise.all([
      import('@mercuryworkshop/scramjet/path'),
      import('@mercuryworkshop/wisp-js/server'),
      import('@mercuryworkshop/libcurl-transport')
    ]);

    app.use('/scramjet/', express.static(scramjetPath, {
      immutable: true,
      maxAge: '1h',
      setHeaders(res) {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      }
    }));

    state.scramjet = true;
    state.libcurl = Boolean(libcurlModule.LibcurlClient || libcurlModule.default);
    state.wasm = true;

    const routeWebSocket = wispModule.routeWebSocket || wispModule.wisp?.routeWebSocket || wispModule.default?.routeWebSocket;
    if (server && routeWebSocket) {
      server.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/wisp/')) return;
        routeWebSocket(req, socket, head);
      });
      state.wisp = true;
    }
  } catch (error) {
    state.reason = error.code === 'ERR_MODULE_NOT_FOUND' ? 'Scramjet packages are not installed in this environment' : error.message;
  }

  app.get('/api/engine', (req, res) => res.json({
    name: 'Diamond',
    transport: state.libcurl ? 'libcurl over Wisp' : 'streaming fallback',
    scramjet: state.scramjet,
    wisp: state.wisp,
    webAssemblyRewriter: state.wasm,
    credit: 'Diamond uses a heavily modified version of Scramjet.',
    fallbackReason: state.reason
  }));

  return state;
}
