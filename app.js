/* ══════════════════════════════════════════════════════════════
   VILTJES — het spel in de browser
   - De openbare stand van de tafel lezen we elke 1,5 seconde uit Firebase.
   - Alles wat een speler doet gaat via de server (/api/game). Wat alleen
     voor jou is (je eigen viltje, het viltje dat je moet omdraaien) komt
     ook daar vandaan.
   ══════════════════════════════════════════════════════════════ */

const IS_DEV = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const DB_URL = IS_DEV ? '/__db' : 'https://viltjes-ravotters-default-rtdb.europe-west1.firebasedatabase.app';
const POLL_MS = 1500;
const MIN_PLAYERS = 3;
const LAST_KEY = 'vt.last', ACCESS_KEY = 'vt.access', AGE_KEY = 'vt.18', NAME_KEY = 'vt.naam';
const RESUME_MAX_MS = 12 * 60 * 60 * 1000;
const COMPUTER = 'De computer';

// ── Stand ─────────────────────────────────────────────────────────
let me = { token: '', pid: '', name: '' };
let code = '';
let game = null;
let priv = null, privKey = '';
let pollTimer = null, pollBusy = false;
let offset = 0;                  // klok van de server min onze klok
let view = '';                   // welk scherm staat er nu in #spel
let vote = { raak: null, nep: null };
let tikKey = '', tikAt = 0;
let resumeOffer = null;

// ── Hulpjes ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (id, cls = 'ico') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
function setHtml(el, html) {
  if (typeof el === 'string') el = $(el);
  if (el && el._html !== html) { el.innerHTML = html; el._html = html; }
}
function showScreen(id) {
  const was = document.querySelector('.screen--active')?.id;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('screen--active', s.id === id));
  if (was !== id) window.scrollTo(0, 0);
}
let toastTimer = null;
function toast(msg, bad) {
  const t = $('toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3400);
}
function showError(id, msg) { const e = $(id); e.textContent = msg || ''; e.hidden = !msg; }
function genToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
function storeGet(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
function storeSet(key, val) { try { if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* geen opslag: het spel werkt gewoon */ } }

async function fbGet(path) {
  const r = await fetch(`${DB_URL}/${path}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Database leesfout (${r.status})`);
  return r.json();
}
async function api(action, data = {}) {
  let r, j = null;
  try {
    r = await fetch('/api/game', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, code, token: me.token, ...data }),
    });
    j = await r.json();
  } catch (e) { throw new Error('Geen verbinding. Probeer het opnieuw.'); }
  if (j && j.now) offset = j.now - Date.now();
  if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Er ging iets mis. Probeer het opnieuw.');
  return j;
}
async function busy(btn, fn) {
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try { await fn(); }
  catch (e) { toast(e.message, true); }
  finally { if (btn) btn.disabled = false; }
}

const players = () => Object.entries(game?.players || {}).sort((a, b) => (a[1].at - b[1].at) || (a[0] < b[0] ? -1 : 1));
const nameOf = pid => game?.players?.[pid]?.name || 'Iemand';
const isHost = () => !!game && game.hostId === me.pid;
const cur = () => game?.cur || null;
const amReader = () => cur()?.reader === me.pid;
const initials = n => String(n).trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// ── Viltjes tekenen: vier vormen plus het logo ────────────────────
const SCHULP = 'M92 50A12 12 0 0 1 86.4 71A12 12 0 0 1 71 86.4A12 12 0 0 1 50 92A12 12 0 0 1 29 86.4A12 12 0 0 1 13.6 71A12 12 0 0 1 8 50A12 12 0 0 1 13.6 29A12 12 0 0 1 29 13.6A12 12 0 0 1 50 8A12 12 0 0 1 71 13.6A12 12 0 0 1 86.4 29A12 12 0 0 1 92 50Z';
let ringNr = 0;
function vorm(v, fill = '#FFFDF8') {
  const dr = 'fill="none" stroke="currentColor" stroke-width="1.2"';
  let s;
  if (v === 'vier') s = `<rect x="3" y="3" width="94" height="94" rx="13" fill="${fill}"/><rect x="9" y="9" width="82" height="82" rx="8" ${dr}/>`;
  else if (v === 'acht') s = `<polygon points="30,3 70,3 97,30 97,70 70,97 30,97 3,70 3,30" fill="${fill}" stroke="${fill}" stroke-width="3" stroke-linejoin="round"/><polygon points="32.5,9 67.5,9 91,32.5 91,67.5 67.5,91 32.5,91 9,67.5 9,32.5" ${dr}/>`;
  else if (v === 'schulp') s = `<path d="${SCHULP}" fill="${fill}"/><circle cx="50" cy="50" r="36" ${dr}/>`;
  else if (v === 'logo') {
    const id = `ring${++ringNr}`;
    s = `<circle cx="50" cy="50" r="47" fill="#2430C8"/><circle cx="50.8" cy="50.8" r="43" fill="none" stroke="#FFCB2E" stroke-width="1.6"/>
      <circle cx="50" cy="50" r="43" fill="none" stroke="#FAF5EA" stroke-width="1.2"/><circle cx="50" cy="50" r="31" fill="none" stroke="#FAF5EA" stroke-width="1.2"/>
      <path id="${id}" d="M50 50m-34.5 0a34.5 34.5 0 1 1 69 0a34.5 34.5 0 1 1 -69 0" fill="none"/>
      <text font-size="5.6" letter-spacing="1.5" fill="#FAF5EA" font-family="Figtree, sans-serif" font-weight="700"><textPath href="#${id}">RAVOTTERS · TERRASSPEL · SCHUNNIG · 18+ ·</textPath></text>`;
  } else s = `<circle cx="50" cy="50" r="47" fill="${fill}"/><circle cx="50" cy="50" r="41" ${dr}/>`;
  return `<svg class="vt__vorm" viewBox="0 0 100 100" aria-hidden="true">${s}</svg>`;
}
const KLEUR = { wit: '#FFFDF8', zon: '#FFCB2E', roze: '#FF8FB8', blauw: '#2430C8' };
const penSize = (t, big) => { const n = String(t || '').length; return big ? (n < 22 ? 34 : n < 40 ? 29 : n < 60 ? 25 : 22) : (n < 22 ? 25 : n < 40 ? 22 : n < 60 ? 19 : 17); };
function stempel(txt, pos, rot) { return `<span class="stempel" style="${pos};--s:${rot}deg">${txt}</span>`; }

// Een antwoord-viltje (of cartoon-kaartje) uit de lijst
function itemHtml(it, { size = 150, kleur = 'wit', extra = '', tag = 'div', attrs = '', big = false, nr = '' } = {}) {
  if (it.lines) {
    const kaart = cartoonHtml(cur()?.prompt, it.lines, true);
    return `<${tag} class="kaartje" ${attrs} style="position:relative;width:100%;transform:rotate(${it.rot / 2}deg);border:0;background:none;padding:0;cursor:inherit">${kaart}${nr ? `<span class="viltje__nr" style="position:absolute;left:6px;bottom:4px;background:#fff;padding:0 4px">${nr}</span>` : ''}${extra}</${tag}>`;
  }
  const q = it.q ? `<span class="viltje__q">${esc(it.q)}</span>` : '';
  return `<${tag} class="viltje viltje--${kleur}" ${attrs} style="width:${size}px;height:${size}px;padding:${Math.round(size * .15)}px;transform:rotate(${it.rot}deg)">
    ${vorm(it.vorm, KLEUR[kleur])}${nr ? `<span class="viltje__nr">${nr}</span>` : ''}${q}<span class="pen" style="font-size:${penSize(it.text, big) - (it.q ? 3 : 0)}px">${esc(it.text)}</span>${extra}</${tag}>`;
}

// Cartoon met tekstwolkjes erover. Het plaatje komt later; tot die tijd de beschrijving.
function cartoonHtml(p, lines, klein) {
  if (!p) return '';
  const n = p.wolkjes.length;
  const wolken = p.wolkjes.map((w, i) => {
    const t = lines ? lines[i] : null;
    const cls = n === 1 ? 'wolk--alleen' : `wolk--${i + 1}`;
    return `<div class="wolk ${cls}${t ? '' : ' wolk--leeg'}" aria-label="Wolkje ${i + 1}: ${esc(w)}">${t ? esc(t) : i + 1}</div>`;
  }).join('');
  return `<div class="cartoon${klein ? ' cartoon--klein' : ''}" role="img" aria-label="${esc(p.tekst)}">
    <div class="cartoon__leeg"><p>${esc(p.tekst)}</p></div>
    <img src="cartoons/${esc(p.id)}.webp" alt="" onerror="this.remove()">
    ${wolken}</div>`;
}

// ── Startscherm ───────────────────────────────────────────────────
function initHome() {
  document.querySelectorAll('.gooi-tafel .vt').forEach(el => {
    const fill = el.dataset.fill || '#FFFDF8';
    if (el.dataset.ink) el.style.color = el.dataset.ink;
    el.insertAdjacentHTML('afterbegin', vorm(el.dataset.vorm, fill));
  });
  $('naam').value = storeGet(NAME_KEY) || '';
  $('toegang').value = storeGet(ACCESS_KEY) || '';
  const params = new URLSearchParams(location.search);
  if (params.get('code')) $('tafelcode').value = params.get('code').toUpperCase().slice(0, 6);
  if (!storeGet(AGE_KEY)) $('leeftijd').hidden = false;
  $('leeftijd-ja').onclick = () => { storeSet(AGE_KEY, true); $('leeftijd').hidden = true; };

  // Alleen lokaal: meekijken als een speler (?als=token&p=pid&c=code&n=naam), handig om te testen
  if (IS_DEV && params.get('als')) {
    storeSet(AGE_KEY, true); $('leeftijd').hidden = true;
    setTimeout(() => resume({ token: params.get('als'), pid: params.get('p'), code: params.get('c'), name: params.get('n') || 'Test' }).catch(e => toast(e.message, true)), 0);
  }
  const last = storeGet(LAST_KEY);
  if (last && last.code && last.token && Date.now() - (last.at || 0) < RESUME_MAX_MS) {
    resumeOffer = last;
    $('resume-what').textContent = `Tafel ${last.code}, als ${last.name}`;
    $('resume-box').hidden = false;
  }
  $('resume-ja').onclick = e => busy(e.currentTarget, () => resume(resumeOffer));
  $('resume-nee').onclick = () => { storeSet(LAST_KEY, null); $('resume-box').hidden = true; };

  $('tafelcode').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); };
  $('aanschuiven').onclick = e => busy(e.currentTarget, async () => {
    showError('home-fout', '');
    const name = $('naam').value.trim(), c = $('tafelcode').value.trim().toUpperCase();
    if (!name) return showError('home-fout', 'Vul eerst je naam in.');
    if (c.length !== 6) return showError('home-fout', 'Een tafelcode heeft 6 tekens.');
    me = { token: genToken(), pid: '', name };
    code = c;
    try {
      const j = await api('join', { name });
      enter(j, name);
    } catch (err) { code = ''; showError('home-fout', err.message); }
  });
  $('open-tafel').onclick = () => { $('open-box').hidden = !$('open-box').hidden; if (!$('open-box').hidden) $('toegang').focus(); };
  $('open-ja').onclick = e => busy(e.currentTarget, async () => {
    showError('home-fout', '');
    const name = $('naam').value.trim(), access = $('toegang').value.trim();
    if (!name) return showError('home-fout', 'Vul eerst je naam in.');
    if (!access) return showError('home-fout', 'Vul je toegangscode in.');
    me = { token: genToken(), pid: '', name };
    code = '';
    try {
      const j = await api('create', { name, access });
      storeSet(ACCESS_KEY, access);
      code = j.code;
      enter(j, name);
    } catch (err) { showError('home-fout', err.message); }
  });
}

function enter(j, name) {
  me.pid = j.pid; code = j.code;
  storeSet(NAME_KEY, name);
  storeSet(LAST_KEY, { code, token: me.token, pid: me.pid, name, at: Date.now() });
  history.replaceState(null, '', location.pathname);
  startPolling();
  poll();
}
async function resume(s) {
  me = { token: s.token, pid: s.pid, name: s.name };
  code = s.code;
  const g = await fbGet(`games/${code}`).catch(() => { throw new Error('Geen verbinding. Probeer het zo nog eens.'); });
  if (!g || !g.players?.[s.pid]) {
    storeSet(LAST_KEY, null); $('resume-box').hidden = true; code = '';
    throw new Error('Die tafel bestaat niet meer.');
  }
  enter({ pid: s.pid, code }, s.name);
}
function leaveToHome() {
  stopPolling();
  storeSet(LAST_KEY, null);
  code = ''; game = null; priv = null; privKey = ''; view = '';
  $('resume-box').hidden = true;
  showScreen('s-home');
}

// ── Verbinding met de tafel ───────────────────────────────────────
function startPolling() { stopPolling(); pollTimer = setInterval(poll, POLL_MS); }
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
async function poll() {
  if (pollBusy || !code) return;
  pollBusy = true;
  try {
    const g = await fbGet(`games/${code}`);
    if (!code) return;
    if (!g) { toast('Deze tafel bestaat niet meer.', true); leaveToHome(); return; }
    if (!g.players?.[me.pid]) { toast('Je zit niet meer aan deze tafel.', true); leaveToHome(); return; }
    game = g;
    await render();
  } catch (e) { /* even geen verbinding: de volgende poging komt vanzelf */ }
  finally { pollBusy = false; }
}
async function loadPrivate(force) {
  const c = cur();
  const key = c ? `${c.n}:${c.phase}` : '';
  if (!force && key === privKey) return;
  privKey = key;
  try { priv = await api('state'); } catch (e) { privKey = ''; }
}

// ── Schermen kiezen ───────────────────────────────────────────────
async function render() {
  if (game.status === 'lobby') { renderLobby(); return showScreen('s-lobby'); }
  if (game.status === 'done') { renderEinde(); return showScreen('s-einde'); }
  await loadPrivate();
  renderSpel();
  showScreen('s-spel');
}

function renderLobby() {
  view = ''; vote = { raak: null, nep: null };
  $('lobby-code').textContent = code;
  const ps = players();
  const R = 112, cx = 50;
  const plekken = ps.map(([pid, p], i) => {
    const a = -Math.PI / 2 + (i / Math.max(ps.length, 1)) * Math.PI * 2;
    const x = 50 + Math.cos(a) * 41, y = 150 + Math.sin(a) * R - 34;
    const kleur = pid === me.pid ? 'zon' : (i % 3 === 1 ? 'wit' : 'wit');
    return `<div class="speler" style="left:${x}%;top:${y}px"><div class="viltje viltje--${kleur}">${vorm(['rond', 'vier', 'acht', 'schulp'][i % 4], KLEUR[kleur])}<span>${esc(initials(p.name))}</span></div><span>${esc(p.name)}${pid === me.pid ? ' (jij)' : ''}</span></div>`;
  }).join('');
  setHtml('lobby-tafel', `<div class="ronde-tafel__blad"><b>${ps.length}</b>aan tafel</div>${plekken}`);
  const host = isHost(), rounds = game.config?.rounds || 5;
  $('lobby-host').hidden = !host;
  $('lobby-wacht').hidden = host;
  $('lobby-hostnaam').textContent = nameOf(game.hostId);
  document.querySelectorAll('#rondes .pil').forEach(b => b.classList.toggle('pil--aan', Number(b.dataset.r) === rounds));
  $('start').hidden = !host;
  $('start').disabled = ps.length < MIN_PLAYERS;
  $('start-uitleg').textContent = ps.length < MIN_PLAYERS
    ? `Nog ${MIN_PLAYERS - ps.length} ${MIN_PLAYERS - ps.length === 1 ? 'speler' : 'spelers'} nodig. Laat ze aanschuiven met de code.`
    : `${rounds} rondes. Wie later aanschuift moet wachten tot het volgende potje.`;
  $('weg').hidden = host;
}

// ── Het spel ──────────────────────────────────────────────────────
function klok() {
  const c = cur();
  const el = $('klok');
  if (!c || !c.deadline || !['schrijf', 'draai', 'stem'].includes(c.phase)) { el.hidden = true; return; }
  const left = Math.max(0, Math.ceil((c.deadline - (Date.now() + offset)) / 1000));
  el.hidden = false;
  el.classList.toggle('klok--krap', left <= 10);
  el.querySelector('span').textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  // Tijd om? Laat de server de fase afsluiten (die controleert zelf de klok)
  if (left === 0 && Date.now() + offset > c.deadline + 1500) {
    const k = `${c.n}:${c.phase}`;
    if (k !== tikKey || Date.now() - tikAt > 4000) { tikKey = k; tikAt = Date.now(); api('tik').then(poll).catch(() => {}); }
  }
}
setInterval(klok, 500);

const SOORT = { gewoon: '', achterkant: 'De Achterkant', cartoon: 'De cartoon' };
function wieKlaar(list) {
  const done = cur()?.done || {};
  return `<div class="wie-klaar">${list.map(p => `<span class="${done[p] ? 'klaar' : ''}">${esc(nameOf(p))}</span>`).join('')}</div>`;
}
function voorlezerBalk(tekst) {
  return `<div class="voorlezer">${ico('i-voorlezer')}<span>${tekst}</span></div>`;
}

function renderSpel() {
  const c = cur();
  if (!c) return;
  $('ronde-nr').textContent = `RONDE ${c.n + 1} VAN ${game.plan.length}${SOORT[c.type] ? ' · ' + SOORT[c.type].toUpperCase() : ''}`;
  klok();
  const key = `${c.n}:${c.phase}`;
  if (c.phase === 'schrijf') return renderSchrijf(c, key);
  if (c.phase === 'draai') return renderDraai(c, key);
  if (c.phase === 'lees') return renderLees(c, key);
  if (c.phase === 'stem') return renderStem(c, key);
  if (c.phase === 'uitslag') return renderUitslag(c, key);
}

function opdrachtViltje(tekst, kleur = 'blauw') {
  const n = tekst.length, fs = n < 50 ? 24 : n < 75 ? 21 : 19;
  return `<div class="viltje opdracht" style="width:290px;height:290px;transform:rotate(-2deg)">${vorm('rond', KLEUR[kleur])}<span class="kop" style="font-size:${fs}px">${esc(tekst)}</span></div>`;
}

// 1. Schrijven
function renderSchrijf(c, key) {
  const schrijft = (c.writers || []).includes(me.pid);
  const ingeleverd = !!c.done?.[me.pid] || priv?.mine !== undefined;
  const k = `${key}:${schrijft}:${ingeleverd}`;
  if (view !== k) {
    view = k;
    vote = { raak: null, nep: null };
    let html = '';
    const lezer = nameOf(c.reader);
    if (c.type === 'cartoon') {
      html += voorlezerBalk(`<b>Iedereen schrijft mee.</b> Vul de wolkjes in. Deze ronde telt dubbel.`);
      html += `<h2 class="kop">Maak de cartoon af</h2>${cartoonHtml(c.prompt, ingeleverd ? priv?.mine : null)}`;
      if (!ingeleverd) {
        html += c.prompt.wolkjes.map((w, i) => `<label class="veld">Wolkje ${c.prompt.wolkjes.length > 1 ? i + 1 + ' · ' : ''}${esc(w)}<input class="invoer invoer--pen" data-wolk="${i}" maxlength="70" autocomplete="off"></label>`).join('');
        html += `<div class="onder"><button id="lever" class="knop">Cartoon inleveren</button><p class="zacht klein">De computer vult er ook een in. Lijkt die van jou op die van een robot? Dat levert juist punten op.</p></div>`;
      }
    } else if (!schrijft) {
      html += voorlezerBalk(`<b>Jij bent de Voorlezer.</b> Lees de opdracht hardop voor. Straks lees je alle viltjes voor.`);
      html += opdrachtViltje(c.type === 'achterkant' ? c.prompt : c.prompt);
      html += c.type === 'achterkant'
        ? `<p class="zacht">Dit is De Achterkant. Iedereen geeft eerst een braaf antwoord. Daarna krijgen ze elkaars viltje en schrijven ze er een schunnige vraag bij.</p>`
        : `<p class="zacht">Jij schrijft deze ronde niet. Bij het stemmen gok je welk viltje wint: goed gegokt is 2 punten.</p>`;
    } else {
      html += voorlezerBalk(`<b>${esc(lezer)}</b> is de Voorlezer en leest straks alle viltjes hardop voor.`);
      html += opdrachtViltje(c.prompt);
      if (c.type === 'achterkant' && !ingeleverd) html += `<p class="stap"><b>De Achterkant:</b> geef een gewoon, braaf antwoord. Straks maakt iemand anders er iets fouts van.</p>`;
      if (!ingeleverd) {
        html += `<label class="veld">Jouw viltje<textarea id="tekst" class="invoer" maxlength="70" rows="3" placeholder="${c.type === 'achterkant' ? 'Gewoon eerlijk antwoord' : 'Kort is beter'}"></textarea></label>
          <div class="onder"><button id="lever" class="knop">Leg je viltje op tafel</button>
          ${c.type === 'gewoon' ? '<p class="zacht klein">De computer schrijft ook een viltje. Lijkt dat van jou op dat van een robot? Dan krijg je bonuspunten.</p>' : ''}</div>`;
      }
    }
    if (ingeleverd) html += `<div class="wacht"><b>Je viltje ligt op tafel.</b><span class="zacht">Wachten op de rest:</span><div id="klaar"></div></div>`;
    else if (!schrijft && c.type !== 'cartoon') html += `<div class="wacht"><span class="zacht">Wie heeft al geschreven:</span><div id="klaar"></div></div>`;
    setHtml('spel', html);
    const btn = $('lever');
    if (btn) btn.onclick = () => busy(btn, async () => {
      if (c.type === 'cartoon') {
        const lines = [...document.querySelectorAll('[data-wolk]')].map(i => i.value.trim());
        if (lines.some(l => !l)) throw new Error('Vul elk wolkje in.');
        await api('schrijf', { lines });
        priv = { ...(priv || {}), mine: lines };
      } else {
        const text = $('tekst').value.trim();
        if (!text) throw new Error('Schrijf eerst iets op je viltje.');
        await api('schrijf', { text });
        priv = { ...(priv || {}), mine: text };
      }
      await poll();
    });
  }
  const box = $('klaar');
  if (box) setHtml(box, wieKlaar(c.writers || []));
}

// 2. De Achterkant: het viltje van een ander omdraaien en de schunnige vraag erbij schrijven
function renderDraai(c, key) {
  const doet = (c.writers2 || []).includes(me.pid) && priv?.task;
  const klaar = !!c.done?.[me.pid] || !!priv?.back;
  const k = `${key}:${!!doet}:${klaar}`;
  if (view !== k) {
    view = k;
    let html = '';
    if (doet && !klaar) {
      html += voorlezerBalk(`<b>Je kreeg het viltje van iemand anders.</b> Draai het om en schrijf de schunnige vraag waar dit antwoord bij past.`);
      html += `<div class="flip" id="draai-flip" style="width:280px;height:280px">
        <div class="flip__binnen">
          <div class="flip__kant">${vorm('vier')}<span class="flip-hint">voorkant</span><span class="pen" style="font-size:${penSize(priv.task, true)}px">${esc(priv.task)}</span></div>
          <div class="flip__kant flip__kant--achter" style="color:var(--inkt)">${vorm('vier', KLEUR.zon)}<span class="flip-hint" style="color:var(--inkt)">achterkant</span>
            <span id="vraag-voorbeeld" class="slab" style="font-size:19px;line-height:1.15;color:var(--inkt);min-height:44px">...?</span>
            <span class="pen" style="font-size:20px;margin-top:8px;opacity:.85">${esc(priv.task)}</span></div>
        </div></div>
        <label class="veld">De schunnige vraag<textarea id="vraag" class="invoer" maxlength="90" rows="2" placeholder="Wat zei je ..."></textarea></label>
        <div class="onder"><button id="lever" class="knop">Achterkant inleveren</button>
        <p class="zacht klein">Jij krijgt de punten als de tafel jouw vraag met dit antwoord de beste vindt.</p></div>`;
    } else {
      html += voorlezerBalk(doet || klaar ? `<b>Je achterkant ligt op tafel.</b> Even wachten op de rest.` : `<b>De viltjes worden omgedraaid.</b> De anderen schrijven nu een schunnige vraag bij elkaars antwoord.`);
      html += `<div class="flip flip--om" style="width:220px;height:220px"><div class="flip__binnen"><div class="flip__kant">${vorm('acht')}</div><div class="flip__kant flip__kant--achter">${vorm('acht', KLEUR.zon)}${ico('i-draai', 'ico-groot')}</div></div></div>`;
      html += `<div class="wacht"><span class="zacht">Wie is klaar:</span><div id="klaar"></div></div>`;
    }
    setHtml('spel', html);
    const f = $('draai-flip');
    if (f) setTimeout(() => f.classList.add('flip--om'), 900);
    const v = $('vraag');
    if (v) v.oninput = () => { $('vraag-voorbeeld').textContent = v.value.trim() || '...?'; };
    const btn = $('lever');
    if (btn) btn.onclick = () => busy(btn, async () => {
      const text = $('vraag').value.trim();
      if (text.length < 2) throw new Error('Schrijf eerst een vraag op de achterkant.');
      await api('draai', { text });
      priv = { ...(priv || {}), back: text };
      await poll();
    });
  }
  const box = $('klaar');
  if (box) setHtml(box, wieKlaar(c.writers2 || []));
}

// 3. Voorlezen: iedereen ziet hetzelfde viltje, de Voorlezer bladert en draait om
function bigItem(it, om) {
  if (!it) return '';
  if (it.lines) return cartoonHtml(cur().prompt, it.lines);
  if (it.q) {
    return `<div class="flip${om ? ' flip--om' : ''}" id="lees-flip" style="width:290px;height:290px;transform:rotate(${it.rot}deg)">
      <div class="flip__binnen">
        <div class="flip__kant" style="color:var(--inkt)">${vorm(it.vorm, KLEUR.zon)}<span class="flip-hint" style="color:var(--inkt)">de vraag</span><span class="slab" style="font-size:22px;line-height:1.15">${esc(it.q)}</span></div>
        <div class="flip__kant flip__kant--achter">${vorm(it.vorm)}<span class="flip-hint">het antwoord</span><span class="pen" style="font-size:${penSize(it.text, true)}px">${esc(it.text)}</span></div>
      </div></div>`;
  }
  return itemHtml(it, { size: 290, big: true });
}
function renderLees(c, key) {
  const items = c.items || [];
  const k = `${key}:${c.shown}`;
  const lezer = amReader() || (isHost() && !game.players?.[c.reader]);
  if (view !== k) {
    view = k;
    const it = items[c.shown];
    let html = voorlezerBalk(amReader()
      ? `<b>Lees voor.</b> Lees ${c.type === 'achterkant' ? 'eerst de vraag, draai het viltje om en lees dan het antwoord' : 'elk viltje hardop en met gevoel'}.`
      : `<b>${esc(nameOf(c.reader))} leest voor.</b> Kijk op van je scherm en luister.`);
    if (c.type !== 'achterkant' && c.type !== 'cartoon') html += `<p class="kop" style="font-size:17px">${esc(c.prompt)}</p>`;
    html += `<div style="display:flex;justify-content:center;padding:8px 0">${bigItem(it, c.om)}</div>`;
    html += `<p class="mono klein" style="text-align:center">VILTJE ${c.shown + 1} VAN ${items.length}</p>`;
    if (lezer) {
      const laatste = c.shown >= items.length - 1;
      html += `<div class="onder">
        ${c.type === 'achterkant' ? `<button id="omdraai" class="knop knop--zon">${ico('i-draai')}<span id="omdraai-tekst">${c.om ? 'Terug naar de vraag' : 'Draai om'}</span></button>` : ''}
        <div class="rij">
          <button id="vorige" class="knop knop--rand" ${c.shown === 0 ? 'disabled' : ''} aria-label="Vorig viltje">${ico('i-terug')}</button>
          ${laatste ? `<button id="stemmen" class="knop" style="flex:1">Iedereen stemmen</button>` : `<button id="volgende" class="knop" style="flex:1">Volgend viltje ${ico('i-pijl')}</button>`}
        </div></div>`;
    } else html += `<p class="zacht" style="text-align:center">Zo meteen stem je op het grappigste viltje en zoek je het viltje van de computer.</p>`;
    setHtml('spel', html);
    const go = k2 => busy(null, async () => { await api('toon', { k: k2, om: false }); await poll(); });
    if ($('vorige')) $('vorige').onclick = () => go(c.shown - 1);
    if ($('volgende')) $('volgende').onclick = e => busy(e.currentTarget, async () => { await api('toon', { k: c.shown + 1, om: false }); await poll(); });
    if ($('stemmen')) $('stemmen').onclick = e => busy(e.currentTarget, async () => { await api('open'); await poll(); });
    if ($('omdraai')) $('omdraai').onclick = e => busy(e.currentTarget, async () => {
      const om = !$('lees-flip').classList.contains('flip--om');
      $('lees-flip').classList.toggle('flip--om', om);
      $('omdraai-tekst').textContent = om ? 'Terug naar de vraag' : 'Draai om';
      await api('toon', { k: c.shown, om });
    });
  }
  // Omdraaien bij de rest van de tafel tegelijk laten gebeuren
  const f = $('lees-flip');
  if (f && !amReader()) f.classList.toggle('flip--om', !!c.om);
}

// 4. Stemmen: eerst het grappigste viltje, dan het viltje van de computer
function renderStem(c, key) {
  const items = c.items || [];
  const gestemd = !!c.done?.[me.pid] || !!priv?.voted;
  const mijn = priv?.myItem || null;
  const kiesbaar = items.filter(i => i.id !== mijn);
  const gokker = amReader() && c.type !== 'cartoon';
  const k = `${key}:${gestemd}:${vote.raak}:${vote.nep}`;
  if (view === k) { const b = $('klaar'); if (b) setHtml(b, wieKlaar(players().map(p => p[0]))); return; }
  view = k;
  let html = '';
  if (gestemd) {
    html += voorlezerBalk(`<b>Je stem is binnen.</b> Even wachten op de rest.`);
    html += `<div class="wacht"><span class="zacht">Wie heeft gestemd:</span><div id="klaar"></div></div>`;
    setHtml('spel', html);
    setHtml('klaar', wieKlaar(players().map(p => p[0])));
    return;
  }
  const stap = !vote.raak ? 1 : !vote.nep ? 2 : 3;
  const vraag = c.type === 'cartoon' ? 'Welke cartoon is het grappigst?' : (c.type === 'achterkant' ? 'Welke vraag met antwoord is het grappigst?' : 'Welk viltje is het grappigst?');
  html += `<p class="stap">${stap === 1
    ? `<b>Stap 1 van 2:</b> ${gokker ? 'gok welk viltje gaat winnen. Klopt het, dan krijg je 2 punten.' : vraag} Tik erop.`
    : stap === 2 ? `<b>Stap 2 van 2:</b> welk viltje schreef de computer? Tik erop.`
    : `<b>Klaar?</b> RAAK en NEP? staan erop. Lever je stem in.`}</p>`;
  if (c.type !== 'achterkant' && c.type !== 'cartoon') html += `<p class="kop" style="font-size:17px">${esc(c.prompt)}</p>`;
  const alleen = items.length % 2 === 1 && c.type !== 'cartoon';
  html += `<div class="stemvak">${items.map((it, i) => {
    const eigen = it.id === mijn;
    const kleur = it.id === vote.raak ? 'zon' : 'wit';
    let extra = '';
    if (it.id === vote.raak) extra += stempel('RAAK', 'right:-6px;top:6px', 11);
    if (it.id === vote.nep) extra += stempel('NEP?', 'left:-8px;top:8px', -13);
    const cls = (alleen && i === items.length - 1 ? ' viltje--alleen' : '') + (eigen ? ' viltje--eigen' : '');
    const nr = eigen ? `${i + 1} · van jou` : `${i + 1}`;
    if (it.lines) return itemHtml(it, { tag: eigen ? 'div' : 'button', attrs: `data-id="${it.id}" class="kaartje${cls}" aria-label="Cartoon ${i + 1}"`, extra, nr });
    return itemHtml(it, { size: 154, kleur, tag: eigen ? 'div' : 'button', attrs: `data-id="${it.id}"`, extra, nr }).replace('class="viltje ', `class="viltje${cls} `);
  }).join('')}</div>`;
  html += `<div class="onder">
    ${stap > 1 ? '<button id="overnieuw" class="tekstknop">Opnieuw kiezen</button>' : ''}
    <button id="stem" class="knop" ${stap < 3 && kiesbaar.length ? 'disabled' : ''}>Stem inleveren</button></div>`;
  setHtml('spel', html);
  document.querySelectorAll('#spel [data-id]').forEach(el => {
    if (el.tagName !== 'BUTTON') return;
    el.onclick = () => {
      const id = el.dataset.id;
      if (!vote.raak) vote.raak = id;
      else if (!vote.nep && id !== vote.raak) vote.nep = id;
      else if (id === vote.nep) vote.nep = null;
      else if (id === vote.raak && !vote.nep) vote.raak = null;
      renderStem(cur(), key);
    };
  });
  if ($('overnieuw')) $('overnieuw').onclick = () => { vote = { raak: null, nep: null }; renderStem(cur(), key); };
  $('stem').onclick = e => busy(e.currentTarget, async () => {
    await api('stem', { raak: vote.raak, nep: vote.nep });
    priv = { ...(priv || {}), voted: { ...vote } };
    await poll();
  });
}

// 5. Uitslag van de ronde
function renderUitslag(c, key) {
  const k = `${key}`;
  const r = c.result || {};
  const items = c.items || [];
  const ord = players();
  const volgende = c.n + 1 < game.plan.length ? nameOf(ord[(c.n + 1) % ord.length]?.[0]) : null;
  const magVerder = amReader() || isHost();
  if (view === k) return;
  view = k;
  vote = { raak: null, nep: null };
  let html = '';
  if (r.leeg) {
    html += `<h2 class="kop">Lege tafel</h2><p class="zacht">Niemand heeft deze ronde iets opgeschreven. Op naar de volgende.</p>`;
  } else {
    const win = items.find(i => i.id === r.win?.[0]);
    const nep = items.find(i => i.id === r.aiId);
    const wie = id => r.wie?.[id] || {};
    const door = id => c.type === 'achterkant' ? `${esc(wie(id).a)} (vraag) en ${esc(wie(id).v)} (antwoord)` : esc(wie(id).v);
    if (c.type === 'cartoon') {
      if (win) html += `<p class="mono klein">RAAK · ${r.counts[win.id].r} ${r.counts[win.id].r === 1 ? 'STEM' : 'STEMMEN'} · ${door(win.id)}</p>${cartoonHtml(c.prompt, win.lines)}`;
      if (nep) html += `<p class="mono klein" style="margin-top:6px">NEP! DEZE WAS VAN DE COMPUTER</p>${cartoonHtml(c.prompt, nep.lines, true)}`;
    } else {
      html += `<div class="uitslag-viltjes">`;
      if (win) html += `<div style="position:absolute;left:0;top:4px">${itemHtml(win, { size: 220, kleur: 'zon', big: true, extra: stempel('RAAK', 'right:-12px;top:10px', 12) + `<span style="font-size:14px;font-weight:700;color:var(--inkt)">${door(win.id)} · ${r.counts[win.id].r}x</span>` })}</div>`;
      else html += `<p class="zacht" style="position:absolute;left:0;top:30px;width:55%">Niemand kreeg een stem voor grappigst.</p>`;
      if (nep) html += `<div style="position:absolute;right:-4px;top:128px">${itemHtml(nep, { size: 172, kleur: 'roze', extra: stempel('NEP!', 'left:-4px;bottom:14px', -10) })}</div>`;
      html += `</div>`;
    }
    const gesnapt = r.snapped || [], erin = r.fooled || [];
    const lijst = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' en ' + a[a.length - 1];
    html += `<p style="margin:0;color:var(--tekst);font-size:15px">${nep ? `<b>Viltje ${items.indexOf(nep) + 1} was van de computer.</b> ` : ''}${gesnapt.length ? `${esc(lijst(gesnapt))} ${gesnapt.length === 1 ? 'had hem' : 'hadden hem'} door.` : 'Niemand had hem door.'}${erin.length ? ` ${esc(lijst(erin))} ${erin.length === 1 ? 'trapte' : 'trapten'} erin.` : ''}${r.gok ? ` ${esc(nameOf(c.reader))} gokte de winnaar ${r.gok.ok ? 'goed' : 'fout'}.` : ''}</p>`;
    html += `<div class="bon"><span class="bon__kop">** DE REKENING${r.mult > 1 ? ' x2' : ''} **</span>${(r.bon || []).map(b => `<div class="bon__regel${b.pid === me.pid ? ' bon__regel--ik' : ''}"><b>${esc(b.pid === me.pid ? 'Jij' : b.name)}</b><span class="bon__wat">${esc(b.wat)}</span><i></i><b>+${b.pts}</b></div>`).join('')}</div>`;
    html += `<details class="terug"><summary class="tekstknop" style="text-decoration:underline;cursor:pointer">Wie schreef wat?</summary><div class="wie-schreef">${items.map((it, i) => `<div><span class="mono klein">${i + 1}</span><span class="pen">${esc(it.q ? it.q + ' ' : '')}${esc(it.lines ? it.lines.join(' / ') : it.text)}</span><span class="klein">${door(it.id)}</span></div>`).join('')}</div></details>`;
  }
  html += `<div class="onder">${magVerder
    ? `<button id="verder" class="knop">${volgende ? `Verder: ${esc(volgende)} leest voor` : 'Naar de eindstand'} ${ico('i-pijl')}</button>`
    : `<p class="zacht" style="text-align:center">${esc(nameOf(c.reader))} tikt zo op verder.</p><button id="verder" class="tekstknop" hidden>Zelf verder</button>`}</div>`;
  setHtml('spel', html);
  const btn = $('verder');
  btn.onclick = () => busy(btn, async () => { await api('verder', { n: c.n }); await poll(); });
  // Blijft de Voorlezer hangen? Na een minuut mag iedereen door.
  if (!magVerder) setTimeout(() => { if (view === k && $('verder')) $('verder').hidden = false; }, Math.max(0, 61000 - (Date.now() + offset - (c.at || 0))));
}

// ── Eindstand ─────────────────────────────────────────────────────
function renderEinde() {
  const ps = players().map(([pid, p]) => ({ pid, name: p.name, score: game.scores?.[pid] || 0, st: game.stats?.[pid] || {} }))
    .sort((a, b) => b.score - a.score);
  const top = ps[0];
  $('einde-sub').textContent = `EINDSTAND NA ${game.plan?.length || ''} RONDES`;
  $('einde-kop').textContent = top ? (ps[1] && ps[1].score === top.score ? 'Gelijkspel aan de top' : `${top.name} heeft de hoogste stapel`) : '';
  const max = Math.max(1, ...ps.map(p => p.score));
  const kleur = i => i === 0 ? 'background:#FFCB2E' : i === 1 ? 'background:#2430C8' : '';
  setHtml('stapels', ps.map((p, i) => {
    const n = Math.max(1, Math.round(p.score / max * 14));
    return `<div class="stapel"><span class="stapel__score">${p.score}</span>${Array.from({ length: n }, (_, k) => `<div class="stapel__vilt" style="${kleur(i)};animation-delay:${(n - k) * 60 + i * 120}ms"></div>`).join('')}</div>`;
  }).join(''));
  setHtml('stapel-namen', ps.map(p => `<span>${esc(p.pid === me.pid ? 'Jij' : p.name)}</span>`).join(''));
  const besteIn = k => { const b = [...ps].sort((a, z) => (z.st[k] || 0) - (a.st[k] || 0))[0]; return b && b.st[k] > 0 ? b : null; };
  const lach = besteIn('raak'), jager = besteIn('snap'), bluf = besteIn('bluf');
  setHtml('prijzen', [
    lach && `<div class="prijs">${ico('i-lach')}<span><b>Lachspier</b> · ${esc(lach.name)}, ${lach.st.raak}x raak</span></div>`,
    jager && `<div class="prijs">${ico('i-robot')}<span><b>Robotjager</b> · ${esc(jager.name)}, ${jager.st.snap}x de computer gesnapt</span></div>`,
    bluf && `<div class="prijs prijs--roze">${ico('i-robot')}<span><b>Beste bluffer</b> · ${esc(bluf.name)}, ${bluf.st.bluf}x voor de computer aangezien</span></div>`,
  ].filter(Boolean).join(''));
  const hist = Object.entries(game.hist || {}).sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)));
  setHtml('hist', hist.map(([, h]) => h ? `<div class="hist-regel"><span class="klein">${esc(h.vraag)}</span><span class="pen">${esc(h.tekst)}</span><span class="mono klein">${esc(h.door)}</span></div>` : '').join(''));
  $('opnieuw').hidden = !isHost();
  $('opnieuw-wacht').hidden = isHost();
}

// ── Knoppen die altijd bestaan ────────────────────────────────────
function initButtons() {
  document.querySelectorAll('#rondes .pil').forEach(b => {
    b.onclick = () => busy(b, async () => { await api('rondes', { rounds: Number(b.dataset.r) }); await poll(); });
  });
  $('start').onclick = e => busy(e.currentTarget, async () => { await api('start'); view = ''; await poll(); });
  $('weg').onclick = e => busy(e.currentTarget, async () => { await api('leave'); leaveToHome(); });
  $('opnieuw').onclick = e => busy(e.currentTarget, async () => { await api('opnieuw'); await poll(); });
  $('naar-huis').onclick = () => leaveToHome();
}

initHome();
initButtons();
