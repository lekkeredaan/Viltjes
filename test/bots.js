/* Nepspelers voor een lokale test in de browser:
     node test/bots.js <TAFELCODE> [aantal] [http://localhost:5177]
   Ze schuiven aan, schrijven, draaien om, lezen voor en stemmen vanzelf. */
const crypto = require('crypto');
const [code, n = 3, base = 'http://localhost:5177'] = process.argv.slice(2);
const NAMES = ['Ruben', 'Mila', 'Jesse', 'Fatima', 'Koen', 'Lotte'];
const ANT = ['met slagroom graag', 'alleen op dinsdag', 'dat zei mijn ex ook', 'niet zonder helm', 'twee keer per week', 'vraag het de buurman'];
const VR = ['Wat fluisterde je in de lift?', 'Wat zei je op de achterbank?', 'Wat riep je in de sauna?'];
const pick = a => a[Math.floor(Math.random() * a.length)];
async function api(token, action, data = {}) {
  const r = await fetch(`${base}/api/game`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, code, token, ...data }) });
  return r.json();
}
const DB = base.includes('localhost') ? `${base}/__db` : 'https://viltjes-ravotters-default-rtdb.europe-west1.firebasedatabase.app';
const game = async () => (await fetch(`${DB}/games/${code}.json`)).json();
(async () => {
  const bots = [];
  for (let i = 0; i < Number(n); i++) {
    const token = crypto.randomBytes(16).toString('hex'), name = NAMES[i];
    const j = await api(token, 'join', { name });
    if (!j.ok) { console.log('join mislukt', j.error); process.exit(1); }
    bots.push({ token, name, pid: j.pid, did: {} });
  }
  console.log('aangeschoven:', bots.map(b => b.name).join(', '));
  for (;;) {
    await new Promise(r => setTimeout(r, 1200));
    const g = await game().catch(() => null);
    if (!g) continue;
    if (g.status === 'done') { console.log('eindstand bereikt'); process.exit(0); }
    const c = g.cur; if (g.status !== 'playing' || !c) continue;
    for (const b of bots) {
      const key = `${c.n}:${c.phase}`;
      if (b.did[key]) continue;
      if (c.phase === 'schrijf' && c.writers.includes(b.pid)) {
        const r = c.prompt.wolkjes ? await api(b.token, 'schrijf', { lines: c.prompt.wolkjes.map(() => pick(ANT)) }) : await api(b.token, 'schrijf', { text: pick(ANT) });
        b.did[key] = true; console.log(b.name, 'schreef', r.ok ? '' : r.error);
      } else if (c.phase === 'draai' && (c.writers2 || []).includes(b.pid)) {
        const r = await api(b.token, 'draai', { text: pick(VR) }); b.did[key] = true; console.log(b.name, 'draaide om', r.ok ? '' : r.error);
      } else if (c.phase === 'lees' && c.reader === b.pid) {
        await new Promise(r => setTimeout(r, 1500));
        const r = await api(b.token, 'open'); b.did[key] = true; console.log(b.name, 'opende het stemmen', r.ok ? '' : r.error);
      } else if (c.phase === 'stem') {
        const s = await api(b.token, 'state');
        const ids = c.items.map(i => i.id).filter(id => id !== s.myItem);
        const r = await api(b.token, 'stem', { raak: ids[0], nep: ids[ids.length - 1] }); b.did[key] = true; console.log(b.name, 'stemde', r.ok ? '' : r.error);
      } else if (c.phase === 'uitslag' && c.reader === b.pid) {
        await new Promise(r => setTimeout(r, 2500));
        const r = await api(b.token, 'verder', { n: c.n }); b.did[key] = true; console.log(b.name, 'tikte verder', r.ok ? '' : r.error);
      }
    }
  }
})();
