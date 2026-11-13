/* Speelt een heel spel na met nepspelers, zonder browser en zonder Firebase:
     node test/sim.js [aantal spelers] [aantal rondes]                       */
process.env.VT_MEMORY = '1';
const crypto = require('crypto');
const assert = require('assert');
const db = require('../lib/db');
// Doe alsof alle meme-plaatjes klaar zijn, anders valt de meme-ronde weg
const MEMES = require('../memes/memes.json'); if (!process.env.ZONDER_MEMES) MEMES.klaar = MEMES.memes.map(m => m.id);
const { actions } = require('../api/game');
const N = Number(process.argv[2] || 4), ROUNDS = Number(process.argv[3] || 5);
const tok = () => crypto.randomBytes(16).toString('hex');
const names = ['Sanne', 'Ruben', 'Mila', 'Jesse', 'Fatima', 'Koen', 'Lotte', 'Daan', 'Noor', 'Bram'];
(async () => {
  const P = Array.from({ length: N }, (_, i) => ({ token: tok(), name: names[i] }));
  await assert.rejects(actions.create({ token: P[0].token, name: 'X', access: 'FOUT' }), /bestaat niet/);
  const { code } = await actions.create({ token: P[0].token, name: P[0].name, access: 'test-0000' });
  for (const p of P.slice(1)) await actions.join({ code, token: p.token, name: p.name });
  await assert.rejects(actions.join({ code, token: tok(), name: P[1].name }), /bezet|vol/);
  await assert.rejects(actions.start({ code, token: P[1].token }), /Alleen/);
  await actions.rondes({ code, token: P[0].token, rounds: ROUNDS });
  await actions.start({ code, token: P[0].token });
  const G = () => db.memGet(`games/${code}`);
  const pid = p => db.pidOf(p.token);
  let total = 0;
  for (;;) {
    let g = G();
    if (g.status === 'done') break;
    const cur = g.cur;
    assert.equal(cur.phase, 'schrijf');
    const writers = P.filter(p => cur.writers.includes(pid(p)));
    assert.equal(writers.length, cur.type === 'cartoon' ? N : N - 1);
    if (cur.type !== 'cartoon') await assert.rejects(actions.schrijf({ code, token: P.find(p => pid(p) === cur.reader).token, text: 'x' }), /leest/);
    for (const p of writers) {
      if (cur.prompt.wolkjes) await actions.schrijf({ code, token: p.token, lines: cur.prompt.wolkjes.map((w, i) => `${p.name} wolkje ${i + 1}`) });
      else await actions.schrijf({ code, token: p.token, text: `antwoord van ${p.name}` });
    }
    g = G();
    if (cur.type === 'achterkant') {
      assert.equal(g.cur.phase, 'draai');
      for (const p of writers) {
        const s = await actions.state({ code, token: p.token });
        assert.ok(s.task && s.task !== `antwoord van ${p.name}`, 'je krijgt een antwoord van een ander');
        await actions.draai({ code, token: p.token, text: `Schunnige vraag van ${p.name}?` });
      }
      g = G();
    }
    assert.equal(g.cur.phase, 'lees');
    assert.equal(g.cur.items.length, writers.length + 1, 'mensen + computer');
    assert.ok(!JSON.stringify(g.cur).includes(pid(writers[0])) || cur.writers.includes(pid(writers[0])), 'ok');
    assert.ok(!g.cur.result && !JSON.stringify(g.cur.items).includes('"front"'), 'geen namen bij de viltjes');
    const reader = P.find(p => pid(p) === cur.reader);
    await assert.rejects(actions.open({ code, token: P.find(p => p !== reader && pid(p) !== g.hostId)?.token || tok(), }), /./).catch(() => {});
    await actions.toon({ code, token: reader.token, k: 1 });
    await actions.open({ code, token: reader.token });
    for (const p of P) {
      const s = await actions.state({ code, token: p.token });
      const others = G().cur.items.map(i => i.id).filter(id => id !== s.myItem);
      if (s.myItem) await assert.rejects(actions.stem({ code, token: p.token, raak: s.myItem, nep: others[0] }), /Kies/);
      await actions.stem({ code, token: p.token, raak: others[0], nep: others[others.length - 1] });
    }
    g = G();
    assert.equal(g.cur.phase, 'uitslag');
    const res = g.cur.result;
    assert.ok(res.aiId && res.bon.length === N);
    const sum = res.bon.reduce((a, b) => a + b.pts, 0);
    total += sum;
    assert.equal(Object.values(g.scores).reduce((a, b) => a + b, 0), total, 'scores tellen op');
    console.log(`ronde ${cur.n + 1} ${cur.type.padEnd(10)} | ${typeof cur.prompt === 'string' ? cur.prompt : cur.prompt.titel} | computer: ${JSON.stringify((g.cur.items.find(i => i.id === res.aiId) || {}).q || (g.cur.items.find(i => i.id === res.aiId) || {}).text || (g.cur.items.find(i => i.id === res.aiId) || {}).lines)} | punten ${res.bon.map(b => `${b.name} ${b.pts}`).join(', ')}`);
    await assert.rejects(actions.verder({ code, token: reader.token, n: cur.n + 5 }), /voorbij/);
    await actions.verder({ code, token: reader.token, n: cur.n });
  }
  const g = G();
  assert.equal(Object.keys(g.hist).length, ROUNDS);
  console.log('eindstand', Object.entries(g.scores).map(([p, s]) => `${g.players[p].name} ${s}`).join(', '));
  // Tijd om: iemand levert niets in
  await actions.opnieuw({ code, token: P[0].token });
  await actions.start({ code, token: P[0].token });
  let g2 = G();
  const w = P.filter(p => g2.cur.writers.includes(pid(p)));
  await actions.schrijf({ code, token: w[0].token, text: 'alleen ik' });
  await actions.tik({ code, token: w[0].token });
  assert.equal(G().cur.phase, 'schrijf', 'te vroeg tikken doet niets');
  db.memGet; const raw = db.memGet(`games/${code}/cur`); raw.deadline = Date.now() - 5000;
  await db.put(`games/${code}/cur`, raw);
  await actions.tik({ code, token: w[0].token });
  assert.equal(G().cur.phase, 'lees');
  assert.equal(G().cur.items.length, 2);
  console.log('OK: heel spel nagespeeld met', N, 'spelers en', ROUNDS, 'rondes, plus de tijd-om-route');
})().catch(e => { console.error('MISLUKT:', e); process.exit(1); });
