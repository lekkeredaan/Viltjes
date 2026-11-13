/* ══════════════════════════════════════════════════════════════
   VILTJES — vaste opdrachten (eigen werk van Ravotters)
   Deze lijsten werken altijd, ook zonder AI. Per opdracht staat er
   één reserve-antwoord bij voor "de computer", voor als de AI niet
   op tijd antwoordt.

   Toon: schunnig en dubbelzinnig, nooit plat expliciet. Niemand aan
   tafel wordt bij naam genomen, geen grappen over afkomst, geloof,
   geaardheid of beperking.
   ══════════════════════════════════════════════════════════════ */

// Gewone ronde: [opdracht, reserve-antwoord van de computer]
const GEWOON = [
  ['Wat staat er in de kleine lettertjes van een onenightstand?', 'ontbijt niet inbegrepen'],
  ['Wat is de slechtste openingszin in de slaapkamer?', 'zullen we eerst even de regels doornemen'],
  ['Wat wil je nooit horen van je bedpartner, halverwege?', 'oh trouwens mijn moeder komt zo'],
  ['Verzin een naam voor een pikante kroeg.', 'Café De Natte Onderzetter'],
  ['Wat is het ergste dat je per ongeluk naar je schoonmoeder kunt appen?', 'zelfde tijd, zelfde hotel?'],
  ['Wat roept een teleurgestelde stripper?', 'ik doe dit ook maar voor mijn studie'],
  ['Wat zeg je als je betrapt wordt in de bezemkast?', 'we zochten de stofzuiger'],
  ['Wat is een slechte naam voor een condoommerk?', 'Hoop & Zegen'],
  ['Waar denkt de ober stiekem aan als hij je bestelling opneemt?', 'zijn ex en haar nieuwe vriend'],
  ['Wat staat er op het bordje aan de deur van een parenclub?', 'schoenen uit, de rest ook'],
  ['Wat is het minst sexy dat je in iemands oor kunt fluisteren?', 'ik heb de belastingaangifte al gedaan'],
  ['Wat is de titel van jouw erotische autobiografie?', 'Vijftig tinten beige'],
  ['Wat hoor je niet graag van de masseur?', 'oeps'],
  ['Waarom lag er vanochtend een onderbroek op het terras?', 'die was van de wind zegt hij'],
  ['Wat zeg je tegen de buren na een luidruchtige nacht?', 'sorry we waren een kast aan het verplaatsen'],
  ['Verzin een cocktail die je alleen na middernacht bestelt.', 'een Natte Neef'],
  ['Wat is de slechtste plek voor een eerste zoen?', 'de wachtkamer van de tandarts'],
  ['Wat staat er in het gastenboek van een louche motel?', 'bed kraakte, wij ook'],
  ['Wat is een rare vraag om te stellen in de sauna?', 'mag ik die van jou even lenen'],
  ['Wat is het geheime ingrediënt van oma\'s "speciale" advocaat?', 'dat weet opa ook niet meer'],
  ['Wat fluistert de bitterbal tegen de mosterd?', 'doop me'],
  ['Wat zeg je beter niet op het naaktstrand?', 'koud hè'],
  ['Wat is een verdachte reden om te laat op je werk te komen?', 'de handboeien wilden niet open'],
  ['Waar staat de afkorting BOB eigenlijk voor?', 'Bijna Ontkleed Buiten'],
  ['Wat is de slechtste bijnaam voor wat er in je broek zit?', 'de teleurstelling'],
  ['Hoe rond je een vrijpartij beleefd af?', 'bedankt voor uw komst'],
  ['Welke review laat je achter na een slechte date?', 'twee sterren, wel een leuke hond'],
  ['Wat zat er echt in die grote doos die de buurvrouw liet bezorgen?', 'een hometrainer, zegt ze'],
  ['Wat is een slecht moment om "ik hou van je" te zeggen?', 'tijdens het afrekenen bij de bouwmarkt'],
  ['Wat staat er op het tegeltje boven jouw bed?', 'wie het eerst slaapt die het eerst snurkt'],
  ['Wat is regel één van strippoker op het terras?', 'de ober doet niet mee'],
  ['Wat riep je vannacht in je slaap?', 'nog één rondje dan'],
  ['Wat is het slechtste cadeau voor Valentijnsdag?', 'een tegoedbon voor relatietherapie'],
  ['Hoe heet de pikante versie van een boerendatingshow?', 'Boer duikt het hooi in'],
  ['Wat doe je nooit met een komkommer?', 'uitlenen'],
  ['Wat zegt de dokter liever niet tijdens het onderzoek?', 'dit heb ik nog nooit gezien'],
  ['Wat staat er in jouw zoekgeschiedenis van gisteravond?', 'hoe krijg je glitter uit een baard'],
  ['Waarom moest het terras ineens ontruimd worden?', 'iemand deed zijn broek uit voor de sfeer'],
  ['Wat is een slechte naam voor een datingapp?', 'Restjesdag'],
  ['Wat neem je mee naar een onbewoond eiland, behalve je fatsoen?', 'massageolie en een fluitketel'],
];

// De Achterkant: [brave vraag, braaf reserve-antwoord van de computer]
const ACHTERKANT = [
  ['Wat zeg je tegen de ober als het eten te lang duurt?', 'moet ik zelf even komen helpen?'],
  ['Wat roep je als je team eindelijk scoort?', 'ja eindelijk, erin!'],
  ['Wat zeg je tegen een kind dat niet wil slapen?', 'nog vijf minuutjes en dan is het echt klaar'],
  ['Wat zeg je als je een veel te zwaar pakket optilt?', 'die is groter dan ik dacht'],
  ['Hoe moedig je iemand aan bij de marathon?', 'niet stoppen je bent er bijna'],
  ['Wat zeg je tegen de kapper als het mislukt is?', 'zo had ik het me niet voorgesteld'],
  ['Wat zeg je als je de pindakaaspot niet open krijgt?', 'kun jij hem even vasthouden'],
  ['Wat zeg je bij de eerste hap van een te hete pizza?', 'heet heet heet, blazen!'],
  ['Wat zeg je tegen je hond in het park?', 'niet aan vreemde mensen likken'],
  ['Wat zeg je als je een tent probeert op te zetten?', 'hij blijft niet overeind staan'],
  ['Wat roep je in de achtbaan?', 'ik wil eruit!'],
  ['Wat zeg je tegen de automonteur?', 'hij maakt een raar geluid als ik gas geef'],
  ['Wat zeg je als je een bouwpakket in elkaar zet?', 'dit past nooit in dat gaatje'],
  ['Wat zeg je tegen de bakker op zaterdagochtend?', 'doe mij maar twee harde bolletjes'],
  ['Wat roep je als de tuinslang ineens aangaat?', 'niet op mij richten!'],
  ['Wat zeg je tegen je collega bij het koffieapparaat?', 'hij doet het alleen als je hard duwt'],
  ['Wat zeg je als je de laatste bitterbal pakt?', 'deze is te lekker om te delen'],
  ['Wat zeg je tijdens het opblazen van een luchtbed?', 'ik krijg er geen lucht meer in'],
  ['Wat zeg je tegen de fietsenmaker?', 'mijn zadel zit veel te hard'],
  ['Wat zeg je als je de barbecue aansteekt?', 'het duurt even voor hij warm is'],
  ['Wat zeg je tegen de tandarts voordat hij begint?', 'doe maar voorzichtig, het is gevoelig'],
  ['Wat zeg je als je een fles ketchup leeg probeert te krijgen?', 'even goed schudden en dan knijpen'],
  ['Wat roep je tijdens het touwtrekken?', 'harder trekken, hij komt!'],
  ['Wat zeg je tegen de verhuizers bij de trap?', 'rustig aan, eerst het hoofd erdoor'],
];

// Reserve-achterkanten van de computer: schunnige vragen die op bijna elk braaf antwoord passen
const NEP_ACHTERKANT = [
  'Wat fluisterde je vannacht in bed?',
  'Wat zei je op je eerste date, na drie wijn?',
  'Wat hoorde de buurman gisteren door de muur?',
  'Wat stond er in je appje van drie uur \'s nachts?',
  'Wat zei je op de achterbank?',
  'Wat hijgde je in de sauna?',
  'Wat riep je in de parenclub?',
  'Wat zei je tegen de stripper op het vrijgezellenfeest?',
  'Wat zei je toen het licht uitging?',
  'Wat zei je tijdens het naaktzwemmen?',
];

// Reserve-antwoorden van de computer bij een opdracht die de AI zelf verzon
const NEP_ANTWOORD = [
  'daar praat ik pas over na vier bier',
  'vraag dat maar aan je moeder',
  'alleen op dinsdag',
  'dat staat nog steeds in de groepsapp',
  'met slagroom',
  'dat mag ik van de rechter niet meer zeggen',
  'twee keer, en de tweede keer was per ongeluk',
  'ik was erbij maar ik heb niks gezien',
];

module.exports = { GEWOON, ACHTERKANT, NEP_ACHTERKANT, NEP_ANTWOORD };
