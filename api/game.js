/* ══════════════════════════════════════════════════════════════
   VILTJES — spelserver (Vercel-functie)
   Alle acties van spelers lopen hierlangs: POST /api/game  { action, ... }

   De telefoons lezen de openbare stand (games/<code>) rechtstreeks uit
   Firebase. Wie welk viltje schreef, welk viltje van de computer is en
   wie waarop stemde staat in de kluis en komt pas bij de uitslag naar
   buiten.

   Een spel bestaat uit 3, 5 of 8 rondes. Soorten rondes:
   - gewoon:     schunnige opdracht, iedereen behalve de Voorlezer schrijft
   - achterkant: braaf antwoord, daarna schrijft een ander er de schunnige vraag bij
   - cartoon:    altijd de laatste ronde, telt dubbel, iedereen schrijft
   Fases: schrijf → (draai) → lees → stem → uitslag
   ══════════════════════════════════════════════════════════════ */

const db = require('../lib/db');
const ai = require('../lib/ai');
const { GEWOON, ACHTERKANT, NEP_ACHTERKANT, NEP_ANTWOORD } = require('../lib/content');
const CARTOON_DATA = require('../cartoons/cartoons.json');
// Alleen cartoons waarvan het plaatje al klaar is (zolang niet alle 24 er zijn)
const KLAAR = new Set(CARTOON_DATA.klaar || []);
const CARTOONS = KLAAR.size ? CARTOON_DATA.cartoons.filter(c => KLAAR.has(c.id)) : CARTOON_DATA.cartoons;

const MIN_PLAYERS = 3, MAX_PLAYERS = 10;
const CODE_API = process.env.VT_CODE_API || 'https://www.ravotters.nl/api/codes/verify';
const GAME_SLUG = 'viltjes';
const MAX_AI_GAMES_PER_DAY = Number(process.env.VT_MAX_AI_GAMES_PER_DAY || 400);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PLAN = {
  3: ['gewoon', 'achterkant', 'cartoon'],
  5: ['gewoon', 'achterkant', 'gewoon', 'achterkant', 'cartoon'],
  8: ['gewoon', 'gewoon', 'achterkant', 'gewoon', 'achterkant', 'gewoon', 'achterkant', 'cartoon'],
};
// Seconden per fase
const TIJD = { schrijf: 90, draai: 90, cartoon: 150, stem: 75 };
const GRACE_MS = 1500;
const VORMEN = ['rond', 'vier', 'acht', 'schulp'];
const NEP_BRAAF = ['even geduld, het komt eraan', 'dat gaat er bij mij niet in', 'nog eentje dan', 'eerst even goed vastpakken'];
const COMPUTER = 'De computer';

class Oops extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const need = (cond, msg, status) => { if (!cond) throw new Oops(msg, status); };

const cleanName = s => String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
const cleanCode = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const cleanText = (s, max = 70) => String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const validToken = t => typeof t === 'string' && /^[a-f0-9]{32,64}$/.test(t);
const today = () => new Date().toISOString().slice(0, 10);

function genCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}
// Voorspelbaar "toeval": dezelfde invoer geeft dezelfde volgorde. Zo maakt het niet uit
// als twee telefoons tegelijk dezelfde fase afsluiten: ze schrijven precies hetzelfde weg.
function rng(seed) {
  let a = parseInt(db.hmac('rng:' + seed).slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const order = game => Object.entries(game.players || {}).sort((a, b) => (a[1].at - b[1].at) || (a[0] < b[0] ? -1 : 1)).map(([pid]) => pid);
const nameOf = (game, key) => key === 'ai' ? COMPUTER : (game.players?.[key]?.name || 'Iemand');

async function load(body, { member = true } = {}) {
  const code = cleanCode(body.code);
  need(code.length === 6, 'Die tafelcode klopt niet.');
  need(validToken(body.token), 'Sessie ongeldig. Herlaad de pagina.');
  const pid = db.pidOf(body.token);
  const [game, vault] = await Promise.all([db.get(`games/${code}`), db.get(db.vaultPath(code))]);
  need(game && vault, 'Deze tafel bestaat niet (meer).', 404);
  if (member) need(game.players?.[pid], 'Je zit niet aan deze tafel.', 403);
  return { code, pid, game, vault, isHost: vault.hostPid === pid };
}

// Wie vraagt het (IP + locatieschatting van Vercel)? Gaat mee naar ravotters.nl voor het
// raadslot en de melding bij gebruik van de mastercode.
function clientInfo(req) {
  const h = (req && req.headers) || {};
  const dec = (v) => { try { return v ? decodeURIComponent(v) : null; } catch (e) { return v || null; } };
  const lat = parseFloat(h['x-vercel-ip-latitude']), lon = parseFloat(h['x-vercel-ip-longitude']);
  return {
    ip: String(h['x-forwarded-for'] || '').split(',')[0].trim() || null,
    geo: Number.isFinite(lat) && Number.isFinite(lon)
      ? { lat, lon, city: dec(h['x-vercel-ip-city']), region: dec(h['x-vercel-ip-country-region']), country: h['x-vercel-ip-country'] || null }
      : null,
  };
}

// Klopt de toegangscode? Wordt gecontroleerd op ravotters.nl (daar zit ook de mastercode).
async function checkAccess(raw, client) {
  const access = String(raw ?? '').trim().toUpperCase().slice(0, 40);
  need(access, 'Vul je toegangscode in.');
  if (db.MEMORY && !process.env.VT_CODE_API) {          // lokaal testen zonder ravotters.nl
    need(access === 'TEST-0000', 'Deze toegangscode bestaat niet. Controleer de code uit je mail.', 403);
    return { expiresAt: new Date(Date.now() + 72 * 3600e3).toISOString() };
  }
  let j = null, status = 0;
  try {
    const r = await fetch(CODE_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: access, gameSlug: GAME_SLUG, ip: client?.ip || undefined, geo: client?.geo || undefined }),
      signal: AbortSignal.timeout(10000),
    });
    status = r.status;
    j = await r.json();
  } catch (e) { j = null; }
  need(!(status === 429 || j?.reason === 'too_many_attempts'), 'Te veel foute pogingen. Wacht tien minuten en probeer het dan opnieuw.', 429);
  need(j && typeof j.valid === 'boolean', 'De toegangscode kon niet gecontroleerd worden. Probeer het zo opnieuw.', 503);
  if (!j.valid) {
    need(false, j.reason === 'expired'
      ? 'Deze toegangscode is verlopen. Een code werkt 72 uur vanaf het eerste gebruik.'
      : 'Deze toegangscode bestaat niet. Controleer de code uit je mail.', 403);
  }
  return { expiresAt: j.expiresAt || null };
}

// ── Rondes ────────────────────────────────────────────────────────
const useAI = vault => ai.hasAI() && !vault.noAI;
const pickFrom = (list, seed) => list[Math.floor(rng(seed)() * list.length)];

// De computer past zijn schrijfstijl een beetje aan de tafel aan (hoofdletter, punt)
function blend(text, humans) {
  let t = String(text || '').trim();
  const h = humans.filter(Boolean);
  if (!t || !h.length) return t;
  const lower = h.filter(x => /^[a-zà-ÿ]/.test(x)).length, upper = h.filter(x => /^[A-ZÀ-Ý]/.test(x)).length;
  if (lower > upper && /^[A-Z][a-zà-ÿ]/.test(t) && !/^[A-Z]\S* [A-Z]/.test(t)) t = t[0].toLowerCase() + t.slice(1);
  if (upper > lower && /^[a-z]/.test(t)) t = t[0].toUpperCase() + t.slice(1);
  const dots = h.filter(x => /\.$/.test(x)).length;
  if (dots * 2 < h.length) t = t.replace(/\.$/, '');
  return t;
}

async function startRound(code, game, vault, n) {
  const plan = game.plan, type = plan[n];
  const ord = order(game);
  const reader = ord[n % ord.length];
  const writers = type === 'cartoon' ? ord : ord.filter(p => p !== reader);
  const count = plan.slice(0, n).filter(t => t === type).length;   // de hoeveelste ronde van deze soort
  let prompt, nep = null, kaart = null;
  if (type === 'cartoon') {
    kaart = CARTOONS[vault.deck.cartoon % CARTOONS.length];
    prompt = { id: kaart.id, titel: kaart.titel, tekst: kaart.tekst, wolkjes: kaart.wolkjes };
    nep = kaart.nep;
  } else {
    const fresh = vault.aiPrompts?.[type] || [];
    if (count % 2 === 1 && fresh[(count - 1) / 2]) prompt = fresh[(count - 1) / 2];   // om en om een verse AI-opdracht
    else {
      const list = type === 'gewoon' ? GEWOON : ACHTERKANT;
      const deck = vault.deck[type];
      [prompt, nep] = list[deck[count % deck.length]];
    }
  }
  const now = Date.now();
  const r = { n, type, nep, base: game.scores || {}, statsBase: game.stats || {} };
  const cur = {
    n, type, phase: 'schrijf', reader, writers, prompt, at: now,
    deadline: now + (type === 'cartoon' ? TIJD.cartoon : TIJD.schrijf) * 1000,
  };
  await db.put(`${db.vaultPath(code)}/r`, r);
  await db.patch(`games/${code}`, { round: n, cur });
  // Nu pas de computer laten schrijven: de spelers zijn al begonnen, dit verzoek duurt alleen wat langer
  if (useAI(vault)) {
    try {
      const out = type === 'cartoon' ? { n, lines: await ai.cartoon(kaart) }
        : type === 'gewoon' ? { n, front: await ai.antwoord(prompt) }
        : { n, front: await ai.voorkant(prompt) };
      await db.put(`${db.vaultPath(code)}/ai`, out);
    } catch (e) { console.error('computer schreef niet mee:', e.message); }
  }
}

// Wat de computer deze ronde op zijn viltje zet (AI als die op tijd was, anders de reserve)
function aiFront(code, vault, type, n) {
  const fromAI = vault.ai && vault.ai.n === n ? vault.ai : null;
  if (type === 'cartoon') return (fromAI?.lines) || vault.r.nep;
  return fromAI?.front || vault.r.nep || pickFrom(type === 'gewoon' ? NEP_ANTWOORD : NEP_BRAAF, `${code}:${n}:nep`);
}

function buildItems(code, n, entries) {
  // entries: [{ front, back, text, lines, q }]
  const rand = rng(`${code}:${n}:items`);
  const mixed = shuffle(entries, rand);
  const items = [], map = {};
  mixed.forEach((e, i) => {
    const id = `v${i + 1}`;
    const it = { id, vorm: VORMEN[Math.floor(rand() * VORMEN.length)], rot: Math.round((rand() * 10 - 5) * 10) / 10 };
    if (e.lines) it.lines = e.lines; else it.text = e.text;
    if (e.q) it.q = e.q;
    items.push(it);
    map[id] = { front: e.front, back: e.back || null };
  });
  return { items, map };
}

async function toLees(code, entries, n) {
  if (!entries.length) return toUitslagLeeg(code);
  const { items, map } = buildItems(code, n, entries);
  await db.put(`${db.vaultPath(code)}/r/map`, map);
  await db.patch(`games/${code}/cur`, { phase: 'lees', items, shown: 0, om: false, deadline: null, done: null, at: Date.now() });
}
async function toUitslagLeeg(code) {
  await db.patch(`games/${code}/cur`, { phase: 'uitslag', result: { leeg: true }, deadline: null, done: null, at: Date.now() });
}

// Schrijven is klaar (iedereen ingeleverd of tijd om)
async function closeWrite(code, game, vault) {
  const cur = game.cur, n = cur.n, type = cur.type;
  const answers = vault.r?.answers || {};
  const humans = (cur.writers || []).filter(p => answers[p]);
  if (!humans.length) return toUitslagLeeg(code);
  if (type === 'cartoon') {
    const entries = humans.map(p => ({ front: p, lines: answers[p] }));
    const all = humans.flatMap(p => answers[p]);
    entries.push({ front: 'ai', lines: aiFront(code, vault, type, n).map(t => blend(t, all)) });
    return toLees(code, entries, n);
  }
  const texts = humans.map(p => answers[p]);
  const aiText = blend(aiFront(code, vault, type, n), texts);
  if (type === 'gewoon') {
    return toLees(code, [...humans.map(p => ({ front: p, text: answers[p] })), { front: 'ai', text: aiText }], n);
  }
  // De Achterkant: de viltjes gaan een plek door. Iedereen (ook de computer) krijgt het antwoord van een ander.
  const ring = shuffle([...humans, 'ai'], rng(`${code}:${n}:ring`));
  const assign = {};   // wie schrijft de achterkant van wiens viltje
  ring.forEach((k, i) => { assign[k] = ring[(i + 1) % ring.length]; });
  const fronts = { ...Object.fromEntries(humans.map(p => [p, answers[p]])), ai: aiText };
  await db.patch(`${db.vaultPath(code)}/r`, { assign, fronts });
  const now = Date.now();
  await db.patch(`games/${code}/cur`, { phase: 'draai', writers2: humans, done: null, deadline: now + TIJD.draai * 1000, at: now });
  if (useAI(vault)) {
    try { await db.put(`${db.vaultPath(code)}/aiBack`, { n, tekst: await ai.achterkant(fronts[assign.ai]) }); }
    catch (e) { console.error('computer schreef geen achterkant:', e.message); }
  }
}

// De achterkanten zijn klaar
async function closeDraai(code, game, vault) {
  const cur = game.cur, n = cur.n;
  const { assign = {}, fronts = {}, backs = {} } = vault.r || {};
  const humanBacks = Object.values(backs);
  const entries = [];
  for (const [writer, target] of Object.entries(assign)) {
    let q = writer === 'ai'
      ? blend((vault.aiBack && vault.aiBack.n === n && vault.aiBack.tekst) || pickFrom(NEP_ACHTERKANT, `${code}:${n}:nepq`), humanBacks)
      : backs[writer];
    if (!q || !fronts[target]) continue;   // geen achterkant geschreven: dit viltje doet niet mee
    entries.push({ front: target, back: writer, text: fronts[target], q });
  }
  if (!entries.some(e => e.back !== 'ai')) return toUitslagLeeg(code);
  return toLees(code, entries, n);
}

// Van wie is dit viltje voor de punten? Bij De Achterkant telt wie de achterkant schreef.
const makerOf = (type, m) => (type === 'achterkant' ? m.back : m.front);

async function closeVote(code, game, vault) {
  const cur = game.cur, n = cur.n, type = cur.type, mult = type === 'cartoon' ? 2 : 1;
  const map = vault.r?.map || {}, votes = vault.r?.votes || {};
  const items = cur.items || [];
  const ids = items.map(i => i.id);
  const aiId = ids.find(id => makerOf(type, map[id]) === 'ai') || null;
  const counts = Object.fromEntries(ids.map(id => [id, { r: 0, n: 0 }]));
  const predicts = type !== 'cartoon';       // de Voorlezer gokt de winnaar, zijn stem telt niet mee
  const pids = order(game);
  for (const pid of pids) {
    const v = votes[pid]; if (!v) continue;
    if (v.raak && counts[v.raak] && !(predicts && pid === cur.reader)) counts[v.raak].r++;
    if (v.nep && counts[v.nep]) counts[v.nep].n++;
  }
  const top = Math.max(0, ...ids.map(id => counts[id].r));
  const win = top > 0 ? ids.filter(id => counts[id].r === top) : [];
  const delta = {}, why = {}, stat = {};
  const add = (pid, pts, text) => { if (!game.players?.[pid]) return; delta[pid] = (delta[pid] || 0) + pts; (why[pid] = why[pid] || []).push(text); };
  const st = (pid, k, v) => { if (!game.players?.[pid]) return; stat[pid] = stat[pid] || { raak: 0, snap: 0, bluf: 0 }; stat[pid][k] += v; };
  for (const id of ids) {
    const m = map[id], maker = makerOf(type, m), c = counts[id];
    if (maker !== 'ai') {
      if (c.r) { add(maker, 2 * mult * c.r, `${c.r}x raak`); st(maker, 'raak', c.r); }
      if (c.n) { add(maker, 2 * mult * c.n, `${c.n}x voor nep aangezien`); st(maker, 'bluf', c.n); }
    }
    if (type === 'achterkant' && m.front !== 'ai' && c.r) add(m.front, c.r, 'voorkant van een raak viltje');
  }
  const snapped = [], fooled = [];
  for (const pid of pids) {
    const v = votes[pid];
    if (aiId && v?.nep === aiId) { add(pid, 3 * mult, 'computer gesnapt'); st(pid, 'snap', 1); snapped.push(pid); }
    else if (aiId && v?.nep) fooled.push(pid);
  }
  let gok = null;
  if (predicts && votes[cur.reader]?.raak) {
    gok = { id: votes[cur.reader].raak, ok: win.includes(votes[cur.reader].raak) };
    if (gok.ok) add(cur.reader, 2, 'winnaar goed gegokt');
  }
  const base = vault.r?.base || {}, statsBase = vault.r?.statsBase || {};
  const scores = {}, stats = {};
  for (const pid of pids) {
    scores[pid] = (Number(base[pid]) || 0) + (delta[pid] || 0);
    const b = statsBase[pid] || {}, s = stat[pid] || {};
    stats[pid] = { raak: (b.raak || 0) + (s.raak || 0), snap: (b.snap || 0) + (s.snap || 0), bluf: (b.bluf || 0) + (s.bluf || 0) };
  }
  const bon = pids.map(pid => ({ pid, name: nameOf(game, pid), wat: (why[pid] || []).join(', ') || 'niks', pts: delta[pid] || 0 }))
    .sort((a, b) => b.pts - a.pts);
  const wie = Object.fromEntries(ids.map(id => [id, { v: nameOf(game, map[id].front), a: map[id].back ? nameOf(game, map[id].back) : null }]));
  const result = { aiId, win, counts, wie, bon, snapped: snapped.map(p => nameOf(game, p)), fooled: fooled.map(p => nameOf(game, p)), gok, mult };
  const best = items.find(i => i.id === (win[0] || aiId)) || items[0];
  const hist = best ? {
    type, vraag: type === 'achterkant' ? best.q : type === 'cartoon' ? cur.prompt.titel : cur.prompt,
    tekst: best.lines ? best.lines.join(' / ') : best.text,
    door: nameOf(game, makerOf(type, map[best.id])),
  } : null;
  await db.patch(`games/${code}`, { scores, stats, [`hist/r${n}`]: hist });
  await db.patch(`games/${code}/cur`, { phase: 'uitslag', result, deadline: null, done: null, at: Date.now() });
}

async function advanceIfDone(code, phase, doneCount, total, fn) {
  if (doneCount < total) return;
  const [game, vault] = await Promise.all([db.get(`games/${code}`), db.get(db.vaultPath(code))]);
  if (game?.cur?.phase === phase) await fn(code, game, vault);
}

// ── Acties ────────────────────────────────────────────────────────
const actions = {
  async checkCode(body, client) { return checkAccess(body.access, client); },

  async create(body, client) {
    need(validToken(body.token), 'Sessie ongeldig. Herlaad de pagina.');
    const name = cleanName(body.name);
    need(name, 'Vul een naam in.');
    const access = await checkAccess(body.access, client);
    const pid = db.pidOf(body.token);
    let code = '';
    for (let i = 0; i < 8; i++) {
      code = genCode();
      if (!(await db.get(`games/${code}/createdAt`))) break;
      code = '';
    }
    need(code, 'Kon geen tafelcode maken. Probeer het opnieuw.', 500);
    const now = Date.now();
    await db.put(db.vaultPath(code), { createdAt: now, hostPid: pid, accessExpiresAt: access.expiresAt });
    await db.put(`games/${code}`, { createdAt: now, status: 'lobby', config: { rounds: 5 }, hostId: pid, round: 0, players: { [pid]: { name, at: now } } });
    await db.patch(db.indexPath(), { [`codes/${code}`]: now }).catch(() => {});
    return { code, pid };
  },

  async join(body) {
    const { code, pid, game } = await load(body, { member: false });
    if (game.players?.[pid]) return { code, pid };   // was er al: gewoon terug aan tafel
    need(game.status === 'lobby', 'Dit spel is al begonnen. Schuif aan bij het volgende potje.');
    const name = cleanName(body.name);
    need(name, 'Vul een naam in.');
    const others = Object.values(game.players || {});
    need(others.length < MAX_PLAYERS, `Deze tafel zit vol (${MAX_PLAYERS} spelers).`);
    need(!others.some(p => p.name.toLowerCase() === name.toLowerCase()), 'Die naam is al bezet. Kies een andere.');
    await db.put(`games/${code}/players/${pid}`, { name, at: Date.now() });
    return { code, pid };
  },

  async leave(body) {
    const { code, pid, game, isHost } = await load(body);
    need(game.status === 'lobby', 'Het spel loopt al.');
    need(!isHost, 'Wie de tafel opende kan niet weglopen.');
    await db.del(`games/${code}/players/${pid}`);
    return {};
  },

  async rondes(body) {
    const { code, game, isHost } = await load(body);
    need(isHost, 'Alleen wie de tafel opende kan dit kiezen.', 403);
    need(game.status === 'lobby', 'Het spel loopt al.');
    const rounds = [3, 5, 8].includes(Number(body.rounds)) ? Number(body.rounds) : 5;
    await db.put(`games/${code}/config/rounds`, rounds);
    return {};
  },

  async start(body) {
    const { code, game, vault, isHost } = await load(body);
    need(isHost, 'Alleen wie de tafel opende kan starten.', 403);
    need(game.status === 'lobby', 'Het spel loopt al.');
    const pids = order(game);
    need(pids.length >= MIN_PLAYERS, `Je hebt minstens ${MIN_PLAYERS} spelers nodig.`);
    need(!vault.accessExpiresAt || Date.now() < Date.parse(vault.accessExpiresAt), 'De toegangscode van deze tafel is verlopen. Open een nieuwe tafel.', 403);
    const plan = PLAN[game.config?.rounds] || PLAN[5];
    const day = today();
    const used = Number(await db.get(`${db.indexPath()}/daily/${day}`).catch(() => 0)) || 0;
    await db.put(`${db.indexPath()}/daily/${day}`, used + 1).catch(() => {});
    const deck = {
      gewoon: shuffle(GEWOON.map((_, i) => i)), achterkant: shuffle(ACHTERKANT.map((_, i) => i)),
      cartoon: Math.floor(Math.random() * CARTOONS.length),
    };
    // Niet twee keer achter elkaar dezelfde cartoon aan dezelfde tafel
    if (vault.lastCartoon === deck.cartoon) deck.cartoon = (deck.cartoon + 1) % CARTOONS.length;
    const noAI = used >= MAX_AI_GAMES_PER_DAY;
    await db.patch(db.vaultPath(code), { deck, noAI, lastCartoon: deck.cartoon, aiPrompts: null, ai: null, aiBack: null });
    const scores = Object.fromEntries(pids.map(p => [p, 0]));
    const fresh = { ...game, status: 'playing', plan, scores, stats: null, hist: null };
    await db.patch(`games/${code}`, { status: 'playing', plan, scores, stats: null, hist: null, startedAt: Date.now() });
    await startRound(code, fresh, { ...vault, deck, noAI, aiPrompts: null, ai: null }, 0);
    // Verse opdrachten voor de latere rondes (lukt het niet, dan komen ze uit de vaste lijst)
    const nG = Math.floor(plan.filter(t => t === 'gewoon').length / 2), nA = Math.floor(plan.filter(t => t === 'achterkant').length / 2);
    if (ai.hasAI() && !noAI && (nG || nA)) {
      try { await db.put(`${db.vaultPath(code)}/aiPrompts`, await ai.opdrachten(Math.max(nG, 1), Math.max(nA, 1))); }
      catch (e) { console.error('geen verse opdrachten:', e.message); }
    }
    return {};
  },

  // Je viltje inleveren (tekst, of bij de cartoon een tekst per wolkje)
  async schrijf(body) {
    const { code, pid, game } = await load(body);
    const cur = game.cur;
    need(game.status === 'playing' && cur?.phase === 'schrijf', 'Schrijven kan nu niet meer.');
    need((cur.writers || []).includes(pid), 'Jij leest deze ronde voor.');
    let val;
    if (cur.type === 'cartoon') {
      const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, cur.prompt.wolkjes.length).map(t => cleanText(t));
      need(lines.length === cur.prompt.wolkjes.length && lines.every(t => t.length >= 1), 'Vul elk wolkje in.');
      val = lines;
    } else {
      val = cleanText(body.text);
      need(val.length >= 1, 'Schrijf eerst iets op je viltje.');
    }
    await db.put(`${db.vaultPath(code)}/r/answers/${pid}`, val);
    await db.put(`games/${code}/cur/done/${pid}`, true);
    const done = Object.keys(game.cur.done || {}).filter(p => p !== pid).length + 1;
    await advanceIfDone(code, 'schrijf', done, cur.writers.length, closeWrite);
    return {};
  },

  // De achterkant van andermans viltje inleveren
  async draai(body) {
    const { code, pid, game, vault } = await load(body);
    const cur = game.cur;
    need(game.status === 'playing' && cur?.phase === 'draai', 'Dat kan nu niet meer.');
    need(vault.r?.assign?.[pid], 'Jij hebt deze ronde geen viltje om om te draaien.');
    const val = cleanText(body.text, 90);
    need(val.length >= 2, 'Schrijf eerst een vraag op de achterkant.');
    await db.put(`${db.vaultPath(code)}/r/backs/${pid}`, val);
    await db.put(`games/${code}/cur/done/${pid}`, true);
    const done = Object.keys(cur.done || {}).filter(p => p !== pid).length + 1;
    await advanceIfDone(code, 'draai', done, (cur.writers2 || []).length, closeDraai);
    return {};
  },

  // De Voorlezer bladert naar een volgend viltje
  async toon(body) {
    const { code, pid, game, isHost } = await load(body);
    const cur = game.cur;
    need(cur?.phase === 'lees', 'Er wordt nu niet voorgelezen.');
    need(pid === cur.reader || isHost, 'Alleen de Voorlezer bladert.', 403);
    const k = Math.min((cur.items || []).length - 1, Math.max(0, Math.round(Number(body.k)) || 0));
    // om = het viltje ligt omgedraaid (bij De Achterkant: eerst de vraag, dan het antwoord)
    await db.patch(`games/${code}/cur`, { shown: k, om: !!body.om });
    return {};
  },

  // De Voorlezer is klaar: stemmen maar
  async open(body) {
    const { code, pid, game, isHost } = await load(body);
    const cur = game.cur;
    need(cur?.phase === 'lees', 'Er wordt nu niet voorgelezen.');
    need(pid === cur.reader || isHost || Date.now() - (cur.at || 0) > 180000, 'Alleen de Voorlezer kan het stemmen openen.', 403);
    const now = Date.now();
    await db.patch(`games/${code}/cur`, { phase: 'stem', deadline: now + TIJD.stem * 1000, done: null, at: now });
    return {};
  },

  async stem(body) {
    const { code, pid, game, vault } = await load(body);
    const cur = game.cur;
    need(game.status === 'playing' && cur?.phase === 'stem', 'Stemmen kan nu niet.');
    const map = vault.r?.map || {};
    const mine = Object.keys(map).find(id => makerOf(cur.type, map[id]) === pid) || null;
    const ok = id => typeof id === 'string' && map[id] && id !== mine;
    const eligible = Object.keys(map).some(id => id !== mine);
    const raak = ok(body.raak) ? body.raak : null, nep = ok(body.nep) ? body.nep : null;
    if (eligible) need(raak && nep, 'Kies eerst het grappigste viltje en daarna het viltje van de computer.');
    await db.put(`${db.vaultPath(code)}/r/votes/${pid}`, { raak, nep });
    await db.put(`games/${code}/cur/done/${pid}`, true);
    const done = Object.keys(cur.done || {}).filter(p => p !== pid).length + 1;
    await advanceIfDone(code, 'stem', done, order(game).length, closeVote);
    return {};
  },

  // De tijd is om: iedere telefoon mag dit melden, de server controleert de klok
  async tik(body) {
    const { code, game, vault } = await load(body);
    const cur = game.cur;
    if (game.status !== 'playing' || !cur?.deadline || Date.now() < cur.deadline + GRACE_MS) return {};
    if (cur.phase === 'schrijf') await closeWrite(code, game, vault);
    else if (cur.phase === 'draai') await closeDraai(code, game, vault);
    else if (cur.phase === 'stem') await closeVote(code, game, vault);
    return {};
  },

  // Naar de volgende ronde, of naar de eindstand
  async verder(body) {
    const { code, pid, game, vault, isHost } = await load(body);
    const cur = game.cur;
    need(game.status === 'playing' && cur?.phase === 'uitslag', 'Dat kan nu nog niet.');
    need(Number(body.n) === cur.n, 'Die ronde is al voorbij.');
    need(pid === cur.reader || isHost || Date.now() - (cur.at || 0) > 60000, 'De Voorlezer of de tafelbaas tikt op verder.', 403);
    if (cur.n + 1 < game.plan.length) await startRound(code, game, vault, cur.n + 1);
    else await db.patch(`games/${code}`, { status: 'done', doneAt: Date.now() });
    return {};
  },

  // Nog een potje met dezelfde tafel
  async opnieuw(body) {
    const { code, game, isHost } = await load(body);
    need(isHost, 'Alleen wie de tafel opende kan opnieuw beginnen.', 403);
    need(game.status === 'done', 'Het spel is nog bezig.');
    await db.patch(`games/${code}`, { status: 'lobby', round: 0, cur: null, plan: null, scores: null, stats: null, hist: null });
    return {};
  },

  // Alleen voor jou: je eigen viltje, het viltje dat je moet omdraaien, je stem
  async state(body) {
    const { pid, game, vault } = await load(body);
    const cur = game.cur, r = vault.r || {};
    if (game.status !== 'playing' || !cur) return {};
    const out = { n: cur.n };
    const mine = r.answers?.[pid];
    if (mine !== undefined) out.mine = mine;
    if (cur.type === 'achterkant' && r.assign?.[pid]) {
      out.task = r.fronts?.[r.assign[pid]] || null;
      out.back = r.backs?.[pid] || null;
    }
    if (r.map) out.myItem = Object.keys(r.map).find(id => makerOf(cur.type, r.map[id]) === pid) || null;
    if (r.votes?.[pid]) out.voted = r.votes[pid];
    return out;
  },
};

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Alleen POST' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const fn = body && Object.prototype.hasOwnProperty.call(actions, body.action) ? actions[body.action] : null;
  if (!fn) return res.status(400).json({ ok: false, error: 'Onbekende actie' });
  try {
    const out = await fn(body, clientInfo(req));
    return res.status(200).json({ ok: true, now: Date.now(), ...out });
  } catch (e) {
    if (e instanceof Oops) return res.status(e.status).json({ ok: false, error: e.message });
    console.error(`actie ${body.action} mislukt:`, e.message);
    return res.status(500).json({ ok: false, error: 'Er ging iets mis op de server. Probeer het opnieuw.' });
  }
}

module.exports = handler;
module.exports.actions = actions;
