# Viltjes

Schunnig terrasspel van Ravotters (18+). Alleen telefoons nodig, 3 tot 10 spelers.
Iedereen schrijft een antwoord op een viltje, de computer schrijft stiekem mee.
Je stemt op het grappigste viltje (RAAK) en zoekt het viltje van de computer (NEP?).

Rondes: 3, 5 of 8. Soorten: gewoon, De Achterkant (braaf antwoord, een ander schrijft er
de schunnige vraag bij) en als laatste altijd de cartoon (wolkjes invullen, telt dubbel).

- `index.html`, `style.css`, `app.js`: het spel in de browser (leest `games/<code>` uit Firebase)
- `api/game.js`: spelserver (Vercel), `api/cleanup.js`: dagelijkse opruiming (48 uur)
- `lib/content.js`: vaste opdrachten, `lib/ai.js`: de computer (Claude API)
- `cartoons/cartoons.json`: 24 cartoons; plaatjes komen als `cartoons/<id>.webp`

Lokaal: `npm run dev` (http://localhost:5177, database in het geheugen, toegangscode `TEST-0000`).
Test: `npm test` (heel spel nagespeeld), `node test/bots.js <CODE> 3` (nepspelers in de browser).

Vercel-omgeving: `ANTHROPIC_API_KEY`, `VT_SERVER_SECRET`, `CRON_SECRET`.
