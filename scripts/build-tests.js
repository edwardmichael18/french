// Builds content/tests/*.json (gates 1–4, mocks A–C) from the item banks.
// Options are shuffled with a seeded RNG so the correct answer isn't always "A", but stays stable between builds.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'content', 'tests');
fs.mkdirSync(OUT, { recursive: true });

function rng(seed) { // mulberry32
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const WEIGHT = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

// explain: optional array of explanations, same order as rows (one per item).
function toItems(rows, kind, seed, explain = []) {
  const r = rng(seed);
  return rows.map(([level, stim, q, correct, ...wrong], n) => {
    const opts = [correct, ...wrong];
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
    const item = { level, weight: WEIGHT[level], q, options: opts, answer: opts.indexOf(correct) };
    if (kind === 'co') { item.say = stim; item.rate = { A1: 0.85, A2: 0.9, B1: 0.95, B2: 1, C1: 1.02, C2: 1.05 }[level]; }
    else item.context = stim;
    if (explain[n]) item.explain = explain[n];
    return item;
  });
}

function checkCounts(name, rows) {
  const c = {}; rows.forEach(r => c[r[0]] = (c[r[0]] || 0) + 1);
  if (rows.length !== 39) console.warn(`⚠ ${name}: ${rows.length} items (TCF uses 39)`);
  return c;
}

function mock(id, bank, seed, opts) {
  checkCounts(id + ' CO', bank.co); checkCounts(id + ' CE', bank.ce);
  const x = opts.explain || {};
  for (const k of ['co', 'ce']) if (x[k] && x[k].length !== bank[k].length) console.warn('⚠ ' + id + ' ' + k + ': ' + x[k].length + ' explanations for ' + bank[k].length + ' items');
  return {
    id, kind: 'mock', title: opts.title, gate: opts.gate || null, timed: opts.timed, intro: opts.intro,
    sections: [
      { id: 'co', type: 'mcq', title: 'Compréhension orale', minutes: 35, playLimit: opts.timed ? 1 : 0, items: toItems(bank.co, 'co', seed, x.co) },
      { id: 'ce', type: 'mcq', title: 'Compréhension écrite', minutes: 60, items: toItems(bank.ce, 'ce', seed + 1, x.ce) },
      { id: 'ee', type: 'writing', title: 'Expression écrite', minutes: 60, tasks: bank.ee },
      { id: 'eo', type: 'speaking', title: 'Expression orale', minutes: 12, tasks: bank.eo }
    ]
  };
}

const A = require('./bank-a'), B = require('./bank-b'), C = require('./bank-c');
const XA = require('./explain-a'), XB = require('./explain-b'), XC = require('./explain-c');

function gate2Listening() {
  const pick = (bank, x, n) => bank.co.map((r, i) => [r, x.co[i]]).filter(([r]) => r[0] === 'B1').slice(0, n);
  const rows = pick(A, XA, 8).concat(pick(B, XB, 4));
  return [rows.map(p => p[0]), 'co', 404, rows.map(p => p[1])];
}

const tests = [
  mock('mockA', A, 101, { explain: XA, title: 'Mock A — Gate 3 (untimed)', gate: 3, timed: false,
    intro: "**Untimed on purpose** — at Gate 3 you're measuring language, not speed. Replay audio as needed the first time; in week 14 redo CO timed. Pass for Gate 3: **CO ≥ 400 · CE ≥ 400 · a 180-word piece at ~9/20 · 3 minutes unprepared.**" }),
  mock('mockB', B, 202, { explain: XB, title: 'Mock B — Gate 4 (timed)', gate: 4, timed: true,
    intro: "**Timed. Audio plays once.** Gate 4 pass: **CO ≥ 458 · CE ≥ 453 · EE tâche 2 at 10/20 · EO tâche 3 sustained.** One ability short: continue. Two or more: defer to April." }),
  mock('mockC', C, 303, { explain: XC, title: 'Mock C — Weeks 19–20 GO / DEFER (exam conditions)', gate: null, timed: true,
    intro: "**Full exam conditions:** CO 35 min → CE 60 min → EE 60 min → EO 12 min, one sitting, phone off, audio once, no dictionary. **Sit the exam only if all four clear with margin.** Re-marking is suspended — there's no appeal behind this rule." }),

  { id: 'gate1', kind: 'gate', gate: 1, title: 'Gate 1 — end of week 4 (12 Oct)', timed: false,
    intro: "Pass: **3–5 min conversation without switching to English · ~900 words · passé composé accurate in speech · pronunciation not fossilising · clear movement against the week-1 recording.** If missed: add two weeks to Block A and book the April sitting — cheap in October, impossible in January.",
    sections: [
      { id: 'drill', type: 'drill', title: 'Core check: present, questions, passé composé', items: [
        { type: 'gap', q: "J'___ (avoir) trente-deux ans.", answer: ['ai'], trap: 'avoiretre' },
        { type: 'mcq', q: "Negate: *J'ai des enfants.*", options: ["Je n'ai pas d'enfants.", "Je n'ai pas des enfants."], answer: 0 },
        { type: 'mcq', q: "\"What's happening?\"", options: ["Qu'est-ce qui se passe ?", "Qu'est-ce que se passe ?"], answer: 0 },
        { type: 'gap', q: "Vous ___ (pouvoir) répéter ?", answer: ['pouvez'] },
        { type: 'mcq', q: "Hier, je ___ au travail à 7 h.", options: ['suis arrivé', 'ai arrivé', 'arrivé'], answer: 0 },
        { type: 'gap', q: "J'ai ___ (prendre) le bus.", answer: ['pris'] },
        { type: 'gap', q: "On a ___ (faire) une pause.", answer: ['fait'] },
        { type: 'mcq', q: "Elle ___ levée tôt.", options: ["s'est", "a", "s'a"], answer: 0 },
        { type: 'mcq', q: "\"I didn't eat.\"", options: ["Je n'ai pas mangé.", "Je n'ai mangé pas.", "Je ne pas ai mangé."], answer: 0 },
        { type: 'gap', q: "Ils ___ (venir) hier soir. (être + venu)", answer: ['sont venus'] },
        { type: 'listen', say: 'dessous', q: 'Which word?', options: ['dessus', 'dessous'], answer: 1, keepOrder: true },
        { type: 'listen', say: 'vont', q: 'Which word?', options: ['vent', 'vont', 'vingt'], answer: 1, keepOrder: true },
        { type: 'mcq', q: 'Default question form?', options: ['est-ce que', 'inversion'], answer: 0 },
        { type: 'mcq', q: "*la garde* means…", options: ['the (hospital) shift / on-call', 'the guard dog', 'the garden'], answer: 0 },
        { type: 'mcq', q: "*une ordonnance* is…", options: ['a prescription', 'an order (military)', 'an ordinance'], answer: 0 }
      ] },
      { id: 'eo', type: 'speaking', title: 'Conversation — 3 to 5 minutes, no English', compareBaseline: true, tasks: [
        { id: 'G1', title: 'Talk about yourself, your work and last weekend', prep: 0, seconds: 300, prompt: "Présentez-vous. Parlez de votre travail. Qu'est-ce que vous avez fait le week-end dernier ? (Present + passé composé. If you blank, use a filler — never switch to English.)" }
      ] },
      { id: 'criteria', type: 'criteria', title: 'Gate 1 criteria — tick honestly (tutor confirms if possible)', items: [
        '3–5 minutes of conversation without switching to English',
        '~900 words known (Anki count)',
        'Passé composé accurate in speech (auxiliary + participle + être agreement)',
        'Pronunciation not fossilising (u/ou, nasals, no diphthongs)',
        'Clear movement against the week-1 recording (listen to both)'
      ], rule: "All five → pass. Otherwise: add two weeks to Block A, book the April sitting." }
    ] },

  { id: 'gate2', kind: 'gate', gate: 2, title: 'Gate 2 — end of week 9 (16 Nov)', timed: true,
    intro: "Pass: **InnerFrench at 1.0× with transcript · ~2,000 words · 120 words in 20 min · 3 min prepared speech.** If missed it's almost always listening volume — add an hour daily for two weeks before changing anything else. ⚠️ Same day: **money decision point**.",
    sections: [
      { id: 'co', type: 'mcq', title: 'Listening check (B1)', minutes: 15, playLimit: 2, items: toItems(...gate2Listening()) },
      { id: 'ee', type: 'writing', title: '120 words in 20 minutes', minutes: 20, tasks: [
        { id: 'EE2', title: 'Récit au passé + avis', min: 120, max: 140, prompt: "Racontez la meilleure journée de votre année (PC + imparfait) et expliquez pourquoi elle était importante pour vous." }
      ] },
      { id: 'eo', type: 'speaking', title: '3-minute prepared speech', tasks: [
        { id: 'G2', title: 'Prepared speech', prep: 600, seconds: 180, prompt: "Si vous pouviez changer une chose dans votre système de santé, que feriez-vous ? (10 min prep with notes, then speak 3 min WITHOUT notes)" }
      ] },
      { id: 'criteria', type: 'criteria', title: 'Gate 2 criteria', items: [
        'Followed an InnerFrench episode at 1.0× with the transcript',
        '~2,000 words known',
        '120 words written in 20 minutes',
        '3-minute prepared speech delivered without notes'
      ], rule: "Listening short? Add an hour of listening daily for two weeks first. Also today: fee fund ≥ ₦400k and contract income landed — else March/April sitting." }
    ] },

  { id: 'gate3', kind: 'gate', gate: 3, title: 'Gate 3 — end of week 13 (14 Dec)', timed: false,
    intro: "Pass: **CO ≥ 400 and CE ≥ 400 on a TCF sample · 180-word piece at ~9/20 · 3 min unprepared.** **Production only missing: normal, Block C fixes it. Comprehension missing: move to April** (the slower of the two to repair).",
    sections: [
      { id: 'link', type: 'link', title: 'Take Mock A (untimed)', href: '/test/mockA' },
      { id: 'criteria', type: 'criteria', title: 'Gate 3 criteria', items: ['CO ≥ 400 (Mock A or official sample)', 'CE ≥ 400', '180-word piece at ~9/20', '3 minutes unprepared, sustained'],
        rule: "Production short only → continue (Block C fixes it). Comprehension short → move to April." }
    ] },

  { id: 'gate4', kind: 'gate', gate: 4, title: 'Gate 4 — end of week 17 (11 Jan) · the last calm decision point', timed: true,
    intro: "Pass: **CO ≥ 458, CE ≥ 453 on a timed mock · EE tâche 2 at 10/20 · EO tâche 3 sustained.** **One ability short: continue. Two or more: defer to April.**",
    sections: [
      { id: 'link', type: 'link', title: 'Take Mock B (timed)', href: '/test/mockB' },
      { id: 'criteria', type: 'criteria', title: 'Gate 4 criteria', items: ['CO ≥ 458 on a timed mock', 'CE ≥ 453 on a timed mock', 'EE tâche 2 at 10/20', 'EO tâche 3 sustained for the full time'],
        rule: "One short → continue. Two or more short → defer to April. Re-marking is suspended: there's no appeal behind this." }
    ] }
];

for (const t of tests) fs.writeFileSync(path.join(OUT, t.id + '.json'), JSON.stringify(t, null, 1));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(tests.map(t => ({ id: t.id, kind: t.kind, gate: t.gate, title: t.title, timed: t.timed })), null, 1));
console.log('Wrote', tests.length, 'tests to', OUT);

// ---------- Skill drills (CO / CE): separate banks so the mocks stay unseen ----------
const SKILLS = path.join(__dirname, '..', 'content', 'skills');
const DOCS = {
  co: { annonce: 'Announcements', message: 'Voicemails & messages', dialogue: 'Conversations', interview: 'Interviews & testimonies', radio: 'Radio & talks' },
  ce: { panneau: 'Signs & notices', annonce: 'Ads', message: 'Emails & letters', article: 'Articles', opinion: 'Opinion pieces' }
};
for (const kind of ['co', 'ce']) {
  const rows = require('./bank-drill-' + kind);
  const r = rng(kind === 'co' ? 505 : 606);
  const items = rows.map(([level, doc, stim, q, correct, w1, w2, w3, explain], n) => {
    if (!DOCS[kind][doc]) throw new Error(kind + ' drill ' + n + ': unknown doc ' + doc);
    const opts = [correct, w1, w2, w3];
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
    const item = { level, weight: WEIGHT[level], doc, q, options: opts, answer: opts.indexOf(correct), explain };
    if (kind === 'co') { item.say = stim; item.rate = { A1: 0.85, A2: 0.9, B1: 0.95, B2: 1, C1: 1.02, C2: 1.05 }[level]; }
    else item.context = stim;
    return item;
  });
  fs.writeFileSync(path.join(SKILLS, 'drill-' + kind + '.json'), JSON.stringify({ docs: DOCS[kind], items }, null, 1));
  console.log('Wrote', items.length, kind.toUpperCase(), 'drill items');
}
