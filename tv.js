/* ══════════════════════════════════════════════════════════════
   VILTJES OP DE TV — meekijken, niet meespelen
   - Leest dezelfde openbare stand van de tafel als elke telefoon.
     De tv ziet dus nooit iets wat niet al op tafel ligt.
   - Gebruikt de tekenhulpjes uit app.js (vorm, itemHtml, cartoonHtml, ...).
   - De stem leest voor op de tv; de Voorlezer bladert op zijn telefoon.
   ══════════════════════════════════════════════════════════════ */

const TV_KEY = 'vt.tv';
let tvView = '';
let tvBusy = false, tvTimer = null;

// Het hele beeld is ontworpen op 1280 x 720 en schaalt mee met de tv
function tvSchaal() {
  const z = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  const st = document.documentElement.style;
  st.setProperty('--tv-z', String(z));
  st.setProperty('--tv-x', `${Math.round((window.innerWidth - 1280 * z) / 2)}px`);
  st.setProperty('--tv-y', `${Math.round((window.innerHeight - 720 * z) / 2)}px`);
}
window.addEventListener('resize', tvSchaal);

function tvInit() {
  document.querySelectorAll('.tv [data-vorm]').forEach(el => el.insertAdjacentHTML('afterbegin', vorm(el.dataset.vorm)));
  tvSchaal();
  const inp = $('tv-code-in');
  const params = new URLSearchParams(location.search);
  inp.value = (params.get('code') || storeGet(TV_KEY) || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  inp.oninput = () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); };
  inp.onkeydown = e => { if (e.key === 'Enter') $('tv-kijk').click(); };
  const stemRij = () => { $('tv-stem-rij').hidden = !(stem.kan() && stem.voice); };
  stemRij();
  if (stem.kan() && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', stemRij);
  $('tv-kijk').onclick = e => busy(e.currentTarget, async () => {
    showError('tv-fout', '');
    const c = inp.value.trim();
    if (c.length !== 6) return showError('tv-fout', 'Een tafelcode heeft 6 tekens.');
    const g = await fbGet(`games/${c}`).catch(() => { throw new Error('Geen verbinding. Probeer het zo nog eens.'); });
    if (!g) return showError('tv-fout', 'Die tafel bestaat niet (meer). Kijk nog eens naar de code.');
    // Deze klik is ook het startsein voor de stem: tv's en telefoons praten pas na een tik
    stem.zet($('tv-stem-in').checked && !$('tv-stem-rij').hidden);
    if (stem.aan) stem.zeg('Viltjes staat op de tv.');
    code = c; game = g; tvView = '';
    storeSet(TV_KEY, c);
    history.replaceState(null, '', `${location.pathname}?code=${c}`);
    $('tv-start').hidden = true;
    $('tv').hidden = false;
    $('tv-code').textContent = c;
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch (err) { /* geen volledig scherm: ook goed */ }
    tvRender();
    clearInterval(tvTimer);
    tvTimer = setInterval(tvPoll, POLL_MS);
  });
}

async function tvPoll() {
  if (tvBusy || !code) return;
  tvBusy = true;
  try {
    const g = await fbGet(`games/${code}`);
    if (!g) {
      clearInterval(tvTimer); code = ''; game = null;
      $('tv').hidden = true; $('tv-start').hidden = false;
      showError('tv-fout', 'Deze tafel is gesloten. Typ een nieuwe code.');
      return;
    }
    game = g;
    tvRender();
  } catch (e) { /* even geen verbinding: de volgende poging komt vanzelf */ }
  finally { tvBusy = false; }
}

// Zet nieuwe inhoud neer, maar alleen als er echt iets veranderd is
function tvZet(key, html) {
  if (key === tvView) return false;
  tvView = key;
  setHtml('tv-spel', html);
  return true;
}
const tvKlaar = list => { const b = $('tv-klaar'); if (b) setHtml(b, wieKlaar(list)); };

function tvRender() {
  const einde = game.status === 'done';
  $('s-einde').hidden = !einde;
  $('tv-spel').hidden = einde;
  if (einde) {
    $('ronde-nr').textContent = 'EINDSTAND';
    $('klok').hidden = true;
    tvView = 'einde';
    renderEinde();
    return;
  }
  if (game.status === 'lobby') { tvLobby(); voorlees(); return; }
  const c = cur();
  if (!c) return;
  $('ronde-nr').textContent = `RONDE ${c.n + 1} VAN ${game.plan.length}${SOORT[c.type] ? ' · ' + SOORT[c.type].toUpperCase() : ''}`;
  klok();
  const fase = `${c.n}:${c.phase}`;
  if (c.phase === 'schrijf') tvSchrijf(c, fase);
  else if (c.phase === 'draai') tvDraai(c, fase);
  else if (c.phase === 'lees') tvLees(c, fase);
  else if (c.phase === 'stem') tvStem(c, fase);
  else if (c.phase === 'uitslag') tvUitslag(c, fase);
  faseIn($('tv-spel'), fase);
  voorlees();
}

// ── Lobby: grote code en wie er al zit ────────────────────────────
function tvLobby() {
  $('ronde-nr').textContent = 'AAN TAFEL';
  $('klok').hidden = true;
  const ps = players();
  const nodig = MIN_PLAYERS - ps.length;
  const key = `lobby:${ps.map(p => p[0] + p[1].name).join(',')}`;
  if (key === tvView) return;
  const html = `<div class="tv-lobby">
    <div class="tv-lobby__links">
      <p class="mono">SCHUIF AAN MET JE TELEFOON</p>
      <p class="tv-url">viltjes.ravotters.nl</p>
      <div class="codeblok"><span class="mono klein">TAFELCODE</span><span class="codeblok__code">${esc(code)}</span></div>
      <p class="tv-sub">${nodig > 0 ? `Nog ${nodig} ${nodig === 1 ? 'speler' : 'spelers'} nodig.` : `${esc(nameOf(game.hostId))} start het spel zodra iedereen er is.`}</p>
    </div>
    <div class="tv-spelers">${ps.map(([pid, p], i) => {
      const nieuw = !lobbyGezien.has(pid); lobbyGezien.add(pid);
      return `<div class="speler tv-speler${nieuw ? ' speler--nieuw' : ''}"><div class="viltje">${vorm(['rond', 'vier', 'acht', 'schulp'][i % 4], i % 3 === 0 ? KLEUR.zon : i % 3 === 1 ? KLEUR.wit : KLEUR.roze)}<span>${esc(initials(p.name))}</span></div><span>${esc(p.name)}</span></div>`;
    }).join('') || '<p class="tv-sub">Nog niemand aan tafel.</p>'}</div>
  </div>`;
  tvZet(key, html);
}

// ── Schrijven ─────────────────────────────────────────────────────
function tvSchrijf(c, fase) {
  const lezer = esc(nameOf(c.reader));
  const regels = metRegels(c.type);
  const uitleg = c.type === 'cartoon' ? 'Iedereen vult de wolkjes in op zijn telefoon. Deze ronde telt dubbel.'
    : c.type === 'meme' ? `Iedereen behalve ${lezer} schrijft een bovenste en een onderste regel.`
    : c.type === 'achterkant' ? 'De Achterkant: geef eerst een braaf antwoord. Straks maakt iemand anders er iets fouts van.'
    : `Schrijf je antwoord op je telefoon. ${lezer} leest straks alles voor.`;
  tvZet(fase, `<div class="tv-twee">
    <div class="tv-twee__links">${regels ? `<div class="tv-cartoon">${cartoonHtml(c.prompt, null)}</div>` : `<div class="tv-groot">${opdrachtViltje(c.prompt)}</div>`}</div>
    <div class="tv-twee__rechts">
      <h2 class="kop tv-kop">${regels ? (c.type === 'meme' ? 'Maak de meme' : 'Maak de cartoon af') : 'Pak je telefoon en schrijf'}</h2>
      <p class="tv-sub">${uitleg}</p>
      <div class="wacht"><span class="mono klein">WIE IS KLAAR</span><div id="tv-klaar"></div></div>
    </div></div>`);
  tvKlaar(c.writers || []);
}

// ── De Achterkant: viltjes gaan om ────────────────────────────────
function tvDraai(c, fase) {
  tvZet(fase, `<div class="tv-twee">
    <div class="tv-twee__links"><div class="tv-groot"><div class="flip tv-draai" style="width:240px;height:240px"><div class="flip__binnen"><div class="flip__kant">${vorm('acht')}</div><div class="flip__kant flip__kant--achter">${vorm('acht', KLEUR.zon)}${ico('i-draai', 'ico-groot')}</div></div></div></div></div>
    <div class="tv-twee__rechts">
      <h2 class="kop tv-kop">De viltjes gaan om</h2>
      <p class="tv-sub">Iedereen kreeg het viltje van een ander. Schrijf er nu een schunnige vraag bij.</p>
      <div class="wacht"><span class="mono klein">WIE IS KLAAR</span><div id="tv-klaar"></div></div>
    </div></div>`);
  tvKlaar(c.writers2 || []);
}

// ── Voorlezen: de tv volgt de Voorlezer ───────────────────────────
function tvLees(c, fase) {
  const items = c.items || [];
  const it = items[c.shown];
  const regels = metRegels(c.type);
  const nieuw = tvZet(`${fase}:${c.shown}`, `<div class="tv-lees">
    ${!regels && c.type !== 'achterkant' ? `<p class="kop tv-vraag">${esc(c.prompt)}</p>` : ''}
    <div class="lees-in ${regels ? 'tv-cartoon tv-cartoon--groot' : 'tv-groot tv-groot--extra'}">${bigItem(it, c.om)}</div>
    <p class="mono tv-teller">${regels ? 'NUMMER' : 'VILTJE'} ${c.shown + 1} VAN ${items.length} · ${esc(nameOf(c.reader).toUpperCase())} BLADERT</p>
  </div>`);
  const f = $('lees-flip');
  if (f) {
    if (nieuw && c.om) { f.classList.add('flip--om'); }
    else f.classList.toggle('flip--om', !!c.om);
  }
}

// ── Stemmen ───────────────────────────────────────────────────────
function tvStem(c, fase) {
  const items = c.items || [];
  const regels = metRegels(c.type);
  const vraag = c.type === 'cartoon' ? 'Welke cartoon is het grappigst?' : c.type === 'meme' ? 'Welke meme is het grappigst?' : c.type === 'achterkant' ? 'Welke vraag met antwoord is het grappigst?' : 'Welk viltje is het grappigst?';
  tvZet(fase, `<div class="tv-stem">
    <div class="tv-stem__kop"><h2 class="kop tv-kop">${vraag}</h2><p class="tv-sub">En welk viltje schreef de computer? Stem op je telefoon.</p></div>
    <div class="stemvak tv-stemvak${regels ? ' tv-stemvak--plaatjes' : ''}">${items.map((it, i) => itemHtml(it, { size: items.length <= 5 ? 230 : items.length <= 8 ? 200 : 175, big: items.length <= 8, nr: String(i + 1) })).join('')}</div>
    <div class="wacht"><span class="mono klein">WIE HEEFT GESTEMD</span><div id="tv-klaar"></div></div>
  </div>`);
  tvKlaar(players().map(p => p[0]));
}

// ── Uitslag ───────────────────────────────────────────────────────
function tvUitslag(c, fase) {
  const r = c.result || {};
  const items = c.items || [];
  if (fase === tvView) return;
  let html;
  if (r.leeg) html = `<div class="tv-midden"><h2 class="kop tv-kop">Lege tafel</h2><p class="tv-sub">Niemand heeft deze ronde iets opgeschreven.</p></div>`;
  else {
    const win = items.find(i => i.id === r.win?.[0]);
    const nep = items.find(i => i.id === r.aiId);
    const wie = id => r.wie?.[id] || {};
    const door = id => c.type === 'achterkant' ? `${esc(wie(id).a)} en ${esc(wie(id).v)}` : esc(wie(id).v);
    const regels = metRegels(c.type);
    const kaart = (it, kleur, stempelTxt, pos, rot) => regels
      ? `<div class="tv-cartoon tv-cartoon--uitslag" style="position:relative">${cartoonHtml(c.prompt, it.lines, true)}${stempel(stempelTxt, pos, rot)}</div>`
      : itemHtml(it, { size: 280, kleur, big: true, extra: stempel(stempelTxt, pos, rot) });
    const gesnapt = r.snapped || [], erin = r.fooled || [];
    const lijst = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' en ' + a[a.length - 1];
    const stand = players().map(([pid, p]) => ({ name: p.name, score: game.scores?.[pid] || 0 })).sort((a, b) => b.score - a.score);
    html = `<div class="tv-uitslag">
      <div class="tv-uitslag__win">
        ${win ? `<p class="mono klein">RAAK · ${r.counts[win.id].r} ${r.counts[win.id].r === 1 ? 'STEM' : 'STEMMEN'}</p>${kaart(win, 'zon', 'RAAK', regels ? 'right:-14px;bottom:14px' : 'right:-14px;top:12px', 12)}<p class="tv-door">${door(win.id)}</p>`
          : '<p class="tv-sub">Niemand kreeg een stem voor grappigst.</p>'}
      </div>
      <div class="tv-uitslag__nep">
        ${nep ? `<p class="mono klein">DEZE WAS VAN DE COMPUTER</p>${kaart(nep, 'roze', 'NEP!', 'left:-6px;bottom:16px', -10)}` : ''}
        <p class="tv-sub">${gesnapt.length ? `${esc(lijst(gesnapt))} ${gesnapt.length === 1 ? 'had hem' : 'hadden hem'} door.` : 'Niemand had hem door.'}${erin.length ? ` ${esc(lijst(erin))} ${erin.length === 1 ? 'trapte' : 'trapten'} erin.` : ''}</p>
      </div>
      <div class="tv-uitslag__bon">
        <div class="bon"><span class="bon__kop">** DE REKENING${r.mult > 1 ? ' x2' : ''} **</span>${(r.bon || []).map((b, i) => `<div style="--i:${i}" class="bon__regel"><b>${esc(b.name)}</b><span class="bon__wat">${esc(b.wat)}</span><i></i><b>+${b.pts}</b></div>`).join('')}</div>
      </div>
      <div class="tv-stand"><span class="mono klein">DE STAND</span>${stand.map((s, i) => `<div class="tv-stand__regel${i === 0 && s.score > 0 ? ' tv-stand__regel--top' : ''}" style="--i:${i}"><span>${esc(s.name)}</span><b>${s.score}</b></div>`).join('')}</div>
    </div>`;
  }
  tvZet(fase, html);
  if (!r.leeg && r.win?.length) setTimeout(() => feest(70), 300);
}

tvInit();
