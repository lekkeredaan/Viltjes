/* ══════════════════════════════════════════════════════════════
   VILTJES — database-laag voor de serverfuncties
   Praat via REST met Firebase Realtime Database.

   Twee soorten gegevens:
   - games/<code>            openbaar voor wie de tafelcode kent (lobby, ronde, vrijgegeven bewijs)
   - vault/<code>/<sleutel>  de kluis: dader, personagekaarten, getuigenkennis, stemmen.
                             <sleutel> wordt berekend met VT_SERVER_SECRET, dat alleen de server kent.
                             Zonder die sleutel is de kluis niet te vinden of te lezen.

   VT_MEMORY=1 (alleen lokaal testen): alles in het geheugen, geen Firebase nodig.
   ══════════════════════════════════════════════════════════════ */

const crypto = require('crypto');

const DB_URL = (process.env.FIREBASE_DB_URL || 'https://viltjes-ravotters-default-rtdb.europe-west1.firebasedatabase.app').replace(/\/+$/, '');
const MEMORY = process.env.VT_MEMORY === '1';
const mem = global.__vtMem || (global.__vtMem = {});

function serverSecret() {
  const s = process.env.VT_SERVER_SECRET || (MEMORY ? 'alleen-voor-lokaal-testen' : '');
  if (!s) throw new Error('VT_SERVER_SECRET ontbreekt');
  return s;
}
function hmac(text) { return crypto.createHmac('sha256', serverSecret()).update(text).digest('hex'); }
function sha256(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

const vaultPath = code => `vault/${code}/${hmac('vault:' + code)}`;
const indexPath = () => `index/${hmac('index')}`;
// Een speler bewijst wie hij is met zijn geheime token; zijn openbare id is daarvan afgeleid.
const pidOf = token => sha256('speler:' + token).slice(0, 16);

// ── Geheugen-variant ──
function memWalk(path, create) {
  const keys = path.split('/').filter(Boolean);
  let node = mem;
  for (let i = 0; i < keys.length - 1; i++) {
    if (node[keys[i]] == null || typeof node[keys[i]] !== 'object') {
      if (!create) return [null, null];
      node[keys[i]] = {};
    }
    node = node[keys[i]];
  }
  return [node, keys[keys.length - 1]];
}
function memSet(path, val) {
  const [node, key] = memWalk(path, true);
  if (val === null || val === undefined) delete node[key];
  else node[key] = JSON.parse(JSON.stringify(val));
}
function memGet(path) {
  const [node, key] = memWalk(path, false);
  const v = node ? node[key] : null;
  return v === undefined ? null : JSON.parse(JSON.stringify(v ?? null));
}

// ── REST ──
async function rest(method, path, body) {
  const r = await fetch(`${DB_URL}/${path}.json`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Database ${method} mislukt (${r.status})`);
  return r.json();
}

async function get(path) { return MEMORY ? memGet(path) : rest('GET', path); }
async function put(path, val) { if (MEMORY) { memSet(path, val); return; } await rest('PUT', path, val); }
async function del(path) { if (MEMORY) { memSet(path, null); return; } await rest('DELETE', path); }
// Meerdere plekken tegelijk bijwerken; sleutels mogen paden zijn ("players/abc/name").
async function patch(path, updates) {
  if (MEMORY) { for (const [k, v] of Object.entries(updates)) memSet(`${path}/${k}`, v); return; }
  await rest('PATCH', path, updates);
}

module.exports = { get, put, del, patch, vaultPath, indexPath, pidOf, hmac, MEMORY, memGet };
