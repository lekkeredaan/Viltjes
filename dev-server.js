/* Lokale testserver (niet voor productie).
   Serveert de site, draait /api/game en speelt de database na in het geheugen:
     node dev-server.js            -> http://localhost:5177
   Met een sleutel in ANTHROPIC_API_KEY doet ook de AI mee. */
process.env.VT_MEMORY = process.env.VT_MEMORY || '1';
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./lib/db');
const routes = { '/api/game': require('./api/game'), '/api/cleanup': require('./api/cleanup') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PORT = Number(process.env.PORT || 5177);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (routes[url.pathname]) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (e) { /* ongeldige JSON */ }
    const r = {
      status(c) { res.statusCode = c; return r; },
      json(o) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); return r; },
    };
    return routes[url.pathname]({ method: req.method, body, headers: req.headers, query: Object.fromEntries(url.searchParams) }, r);
  }
  if (url.pathname.startsWith('/__db/')) {
    // Nagespeelde Firebase: alleen games/<code> is leesbaar, net als in de echte regels
    const p = decodeURIComponent(url.pathname.slice(6).replace(/\.json$/, ''));
    const ok = /^games\/[A-Z0-9]{6}(\/|$)/.test(p);
    res.statusCode = ok ? 200 : 401;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(ok ? db.memGet(p) : { error: 'Permission denied' }));
  }
  const file = path.join(__dirname, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([\/])+/, ''));
  if (!file.startsWith(__dirname) || !TYPES[path.extname(file)] || !fs.existsSync(file)) { res.statusCode = 404; return res.end('Niet gevonden'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)]);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Viltjes lokaal op http://localhost:${PORT}`));
